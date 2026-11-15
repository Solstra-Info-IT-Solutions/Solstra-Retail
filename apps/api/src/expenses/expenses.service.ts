import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { tenantFilter } from '../common/tenant-scoped.service';
import { AccountingService } from '../accounting/accounting.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { AddExpensePaymentDto } from './dto/add-expense-payment.dto';
import { ListExpensesDto } from './dto/list-expenses.dto';
import { ReviewExpenseDto } from './dto/review-expense.dto';
import { Expense, ExpenseDocument } from './schemas/expense.schema';
import { JournalEntry } from '../accounting/schemas/journal-entry.schema';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name) private readonly expenses: Model<ExpenseDocument>,
    private readonly accounting: AccountingService,
    @InjectModel(JournalEntry.name) private readonly journals: Model<any>,
  ) {}

  async create(tenantId: string, userId: string, role: string, dto: CreateExpenseDto) {
    this.validateIdentity(tenantId, userId);
    const title = dto.title?.trim();
    const category = dto.category?.trim();
    const amountPaise = this.toPaise(dto.amount);
    if (!title || !category || title.length > 120 || category.length > 60 || amountPaise <= 0) {
      throw new BadRequestException('A valid title, category and positive amount are required');
    }
    const expenseDate = dto.expenseDate ? new Date(dto.expenseDate) : new Date();
    if (Number.isNaN(expenseDate.getTime())) throw new BadRequestException('Invalid expense date');
    const session = await this.expenses.db.startSession();
    let created: ExpenseDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const [expense] = await this.expenses.create([{
          tenantId: new Types.ObjectId(tenantId), createdBy: new Types.ObjectId(userId),
          title, category, description: dto.description?.trim() || '',
          amount: amountPaise / 100, expenseDate,
          payee: dto.payee?.trim() || '', reference: dto.reference?.trim() || '',
          attachmentUrl: dto.attachmentUrl?.trim() || '',
          status: 'UNPAID', approvalStatus: role === 'staff' ? 'PENDING_APPROVAL' : 'APPROVED',
          approvalHistory: [], paidAmount: 0, dueAmount: amountPaise / 100, payments: [],
        }], { session });
        if (expense.approvalStatus === 'APPROVED') {
          await this.accounting.postOperationalJournal({
            tenantId, userId, postingDate: expenseDate,
            narration: `Expense: ${title}`, sourceType: 'EXPENSE', sourceId: expense._id.toString(),
            lines: [
              { accountCode: '5200', debit: amountPaise / 100, credit: 0, description: category },
              { accountCode: '2000', debit: 0, credit: amountPaise / 100, description: dto.payee?.trim() || title },
            ],
            session,
          });
        }
        created = expense;
      });
    } finally {
      await session.endSession();
    }
    if (!created) throw new Error('Expense could not be created');
    return created;
  }

  async review(tenantId: string, userId: string, id: string, dto: ReviewExpenseDto) {
    this.validateIdentity(tenantId, userId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid expense ID');
    const reason = dto.reason?.trim();
    if (!['APPROVED', 'REJECTED'].includes(dto.decision) || !reason || reason.length < 5 || reason.length > 500) {
      throw new BadRequestException('A valid decision and review reason are required');
    }
    const session = await this.expenses.db.startSession();
    let result: ExpenseDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const expense = await this.expenses.findOne(
          tenantFilter(tenantId, { _id: new Types.ObjectId(id) }),
        ).session(session);
        if (!expense) throw new NotFoundException('Expense not found');
        if (expense.approvalStatus !== 'PENDING_APPROVAL') {
          throw new BadRequestException('Only pending expenses can be reviewed');
        }
        if (expense.createdBy.toString() === userId) {
          throw new BadRequestException('Expense creators cannot approve or reject their own submissions');
        }
        const reviewedAt = new Date();
        expense.approvalStatus = dto.decision;
        expense.approvalHistory.push({
          decision: dto.decision, reason, reviewedBy: new Types.ObjectId(userId), reviewedAt,
        } as any);
        await expense.save({ session });
        if (dto.decision === 'APPROVED') {
          await this.accounting.postOperationalJournal({
            tenantId, userId, postingDate: expense.expenseDate,
            narration: `Expense: ${expense.title}`, sourceType: 'EXPENSE', sourceId: expense._id.toString(),
            lines: [
              { accountCode: '5200', debit: expense.amount, credit: 0, description: expense.category },
              { accountCode: '2000', debit: 0, credit: expense.amount, description: expense.payee || expense.title },
            ],
            session,
          });
        }
        result = expense;
      });
    } finally {
      await session.endSession();
    }
    if (!result) throw new Error('Expense review could not be recorded');
    return result;
  }

  async addPayment(tenantId: string, userId: string, id: string, dto: AddExpensePaymentDto) {
    this.validateIdentity(tenantId, userId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid expense ID');
    const key = dto.idempotencyKey?.trim();
    const amountPaise = this.toPaise(dto.amount);
    if (!key || !/^[0-9a-f-]{36}$/i.test(key) || amountPaise <= 0) {
      throw new BadRequestException('A valid idempotency key and positive payment amount are required');
    }
    const session = await this.expenses.db.startSession();
    let result: ExpenseDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const expense = await this.expenses.findOne(
          tenantFilter(tenantId, { _id: new Types.ObjectId(id) }),
        ).session(session);
        if (!expense) throw new NotFoundException('Expense not found');
        if (expense.approvalStatus !== 'APPROVED') throw new BadRequestException('Only approved expenses can be paid');
        const existingPayment = expense.payments.find((payment) => payment.idempotencyKey === key);
        if (existingPayment) {
          if (!this.samePayment(existingPayment, dto)) {
            throw new ConflictException('This idempotency key has already been used for a different expense payment');
          }
          result = expense;
          return;
        }
        const duePaise = this.toPaise(expense.dueAmount);
        if (amountPaise > duePaise) throw new BadRequestException('Payment exceeds the outstanding expense amount');
        const method = dto.method;
        const cashOrBank = method === 'CASH' ? '1000' : '1010';
        const paidAt = new Date();
        expense.payments.push({
          idempotencyKey: key, method, amount: amountPaise / 100,
          reference: dto.reference?.trim() || '', paidAt, paidBy: new Types.ObjectId(userId),
        } as any);
        expense.paidAmount = this.toPaise(expense.paidAmount + amountPaise / 100) / 100;
        expense.dueAmount = (duePaise - amountPaise) / 100;
        expense.status = expense.dueAmount === 0 ? 'PAID' : 'PARTIALLY_PAID';
        await expense.save({ session });
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: paidAt,
          narration: `Payment for expense: ${expense.title}`,
          sourceType: 'PAYMENT', sourceId: `EXPENSE:${expense._id.toString()}:${key}`,
          lines: [
            { accountCode: '2000', debit: amountPaise / 100, credit: 0, description: expense.title },
            { accountCode: cashOrBank, debit: 0, credit: amountPaise / 100, description: method },
          ],
          session,
        });
        result = expense;
      });
    } finally {
      await session.endSession();
    }
    if (!result) throw new Error('Expense payment could not be recorded');
    return result;
  }

  async findAll(tenantId: string, query: ListExpensesDto) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant ID');
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      const from = query.from ? new Date(query.from) : null;
      const to = query.to ? new Date(query.to) : null;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) {
        throw new BadRequestException('Invalid expense date range');
      }
      filter.expenseDate = {};
      if (from) filter.expenseDate.$gte = from;
      if (to) filter.expenseDate.$lte = to;
    }
    if (query.search?.trim()) {
      const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { category: { $regex: escaped, $options: 'i' } },
        { payee: { $regex: escaped, $options: 'i' } },
        { reference: { $regex: escaped, $options: 'i' } },
      ];
    }
    const scoped = tenantFilter(tenantId, filter);
    const [items, total, summary] = await Promise.all([
      this.expenses.find(scoped).sort({ expenseDate: -1, createdAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      this.expenses.countDocuments(scoped),
      this.expenses.aggregate([
        { $match: tenantFilter(tenantId, {}) },
        { $group: {
          _id: null,
          totalAmount: { $sum: { $cond: [{ $eq: ['$approvalStatus', 'APPROVED'] }, '$amount', 0] } },
          paidAmount: { $sum: { $cond: [{ $eq: ['$approvalStatus', 'APPROVED'] }, '$paidAmount', 0] } },
          dueAmount: { $sum: { $cond: [{ $eq: ['$approvalStatus', 'APPROVED'] }, '$dueAmount', 0] } },
          expenseCount: { $sum: { $cond: [{ $eq: ['$approvalStatus', 'APPROVED'] }, 1, 0] } },
          pendingApprovalCount: { $sum: { $cond: [{ $eq: ['$approvalStatus', 'PENDING_APPROVAL'] }, 1, 0] } },
        } },
      ]),
    ]);
    return {
      items, summary: summary[0] ?? { totalAmount: 0, paidAmount: 0, dueAmount: 0, expenseCount: 0, pendingApprovalCount: 0 },
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async reconciliation(tenantId: string, query: ListExpensesDto) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant ID');
    const from = query.from ? new Date(query.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = query.to ? new Date(query.to) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException('Invalid expense reconciliation date range');
    }
    to.setHours(23, 59, 59, 999);

    const scoped = tenantFilter(tenantId, {
      $or: [
        { expenseDate: { $gte: from, $lte: to } },
        { payments: { $elemMatch: { paidAt: { $gte: from, $lte: to } } } },
      ],
    });
    const [expenses, journalRows] = await Promise.all([
      this.expenses.find(scoped)
        .select('_id title expenseDate amount approvalStatus payments')
        .lean(),
      this.journals.find(tenantFilter(tenantId, {
        status: 'POSTED',
        postingDate: { $gte: from, $lte: to },
        $or: [
          { sourceType: 'EXPENSE' },
          { sourceType: 'PAYMENT', sourceId: { $regex: '^EXPENSE:' } },
        ],
      })).select('sourceType sourceId lines postingDate').lean(),
    ]);

    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const journalBySource = new Map<string, any>();
    for (const journal of journalRows as any[]) {
      if (journal.sourceId) journalBySource.set(journal.sourceId, journal);
    }

    let expectedExpenseAmount = 0;
    let postedExpenseAmount = 0;
    let expectedPaymentAmount = 0;
    let postedPaymentAmount = 0;
    const discrepancies: Array<Record<string, unknown>> = [];

    for (const expense of expenses as any[]) {
      const expenseId = String(expense._id);
      const expenseDate = new Date(expense.expenseDate);
      if (expense.approvalStatus === 'APPROVED' && expenseDate >= from && expenseDate <= to) {
        expectedExpenseAmount = round(expectedExpenseAmount + expense.amount);
        const journal = journalBySource.get(expenseId);
        const lines = journal?.lines ?? [];
        const debit = round(lines.filter((line: any) => line.accountCode === '5200')
          .reduce((sum: number, line: any) => sum + line.debit, 0));
        const credit = round(lines.filter((line: any) => line.accountCode === '2000')
          .reduce((sum: number, line: any) => sum + line.credit, 0));
        postedExpenseAmount = round(postedExpenseAmount + debit);
        if (!journal || Math.abs(debit - expense.amount) >= 0.01 || Math.abs(credit - expense.amount) >= 0.01) {
          discrepancies.push({
            type: journal ? 'EXPENSE_JOURNAL_AMOUNT_MISMATCH' : 'MISSING_EXPENSE_JOURNAL',
            expenseId, title: expense.title, expectedAmount: expense.amount,
            postedExpenseDebit: debit, postedPayableCredit: credit,
          });
        }
      }

      for (const payment of expense.payments ?? []) {
        const paidAt = new Date(payment.paidAt);
        if (paidAt < from || paidAt > to) continue;
        expectedPaymentAmount = round(expectedPaymentAmount + payment.amount);
        const sourceId = `EXPENSE:${expenseId}:${payment.idempotencyKey}`;
        const journal = journalBySource.get(sourceId);
        const lines = journal?.lines ?? [];
        const debit = round(lines.filter((line: any) => line.accountCode === '2000')
          .reduce((sum: number, line: any) => sum + line.debit, 0));
        const credit = round(lines.filter((line: any) => ['1000', '1010'].includes(line.accountCode))
          .reduce((sum: number, line: any) => sum + line.credit, 0));
        postedPaymentAmount = round(postedPaymentAmount + credit);
        if (!journal || Math.abs(debit - payment.amount) >= 0.01 || Math.abs(credit - payment.amount) >= 0.01) {
          discrepancies.push({
            type: journal ? 'EXPENSE_PAYMENT_JOURNAL_AMOUNT_MISMATCH' : 'MISSING_EXPENSE_PAYMENT_JOURNAL',
            expenseId, title: expense.title, paymentReference: payment.reference || '',
            expectedAmount: payment.amount, postedPayableDebit: debit, postedCashBankCredit: credit,
          });
        }
      }
    }

    const expenseDifference = round(expectedExpenseAmount - postedExpenseAmount);
    const paymentDifference = round(expectedPaymentAmount - postedPaymentAmount);
    return {
      from, to, currency: 'INR', amountUnit: 'RUPEES',
      basis: 'APPROVED_EXPENSES_AND_RECORDED_PAYMENTS_VS_POSTED_SOURCE_JOURNALS',
      expenses: {
        expected: expectedExpenseAmount, posted: postedExpenseAmount,
        difference: expenseDifference, reconciled: Math.abs(expenseDifference) < 0.01,
      },
      payments: {
        expected: expectedPaymentAmount, posted: postedPaymentAmount,
        difference: paymentDifference, reconciled: Math.abs(paymentDifference) < 0.01,
      },
      discrepancyCount: discrepancies.length,
      discrepancies: discrepancies.slice(0, 50),
      truncated: discrepancies.length > 50,
      note: 'This source-journal control does not reconcile bank statements or independently verify external payment settlement.',
    };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid tenant or expense ID');
    }
    const expense = await this.expenses.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id) })).lean();
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  private samePayment(existing: any, dto: AddExpensePaymentDto): boolean {
    return existing.method === dto.method
      && this.toPaise(existing.amount) === this.toPaise(dto.amount)
      && (existing.reference || '') === (dto.reference?.trim() || '');
  }

  private toPaise(value: number): number {
    if (!Number.isFinite(value)) throw new BadRequestException('Invalid monetary amount');
    return Math.round((value + Number.EPSILON) * 100);
  }

  private validateIdentity(tenantId: string, userId: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid tenant or user identity');
    }
  }
}
