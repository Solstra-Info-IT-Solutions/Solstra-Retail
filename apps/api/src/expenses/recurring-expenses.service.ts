import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { tenantFilter } from '../common/tenant-scoped.service';
import { AccountingService } from '../accounting/accounting.service';
import { Expense, ExpenseDocument } from './schemas/expense.schema';
import { RecurringExpenseSchedule, RecurringExpenseScheduleDocument } from './schemas/recurring-expense.schema';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto';

@Injectable()
export class RecurringExpensesService {
  constructor(
    @InjectModel(Expense.name) private readonly expenses: Model<ExpenseDocument>,
    @InjectModel(RecurringExpenseSchedule.name) private readonly schedules: Model<RecurringExpenseScheduleDocument>,
    private readonly accounting: AccountingService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateRecurringExpenseDto) {
    this.validateIdentity(tenantId, userId);
    const title = dto.title?.trim();
    const category = dto.category?.trim();
    const amountPaise = this.paise(dto.amount);
    const nextRunAt = new Date(dto.nextRunAt);
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (!title || title.length > 120 || !category || category.length > 60 || amountPaise <= 0 ||
      Number.isNaN(nextRunAt.getTime()) || (endDate && (Number.isNaN(endDate.getTime()) || endDate < nextRunAt))) {
      throw new BadRequestException('Valid expense details, first run date and optional end date are required');
    }
    return this.schedules.create({
      tenantId: new Types.ObjectId(tenantId), createdBy: new Types.ObjectId(userId),
      title, category, description: dto.description?.trim() || '',
      amount: amountPaise / 100, payee: dto.payee?.trim() || '',
      reference: dto.reference?.trim() || '', frequency: dto.frequency,
      nextRunAt, anchorDay: nextRunAt.getUTCDate(), endDate, status: 'ACTIVE',
      lastGeneratedAt: null, lastGeneratedPeriod: null,
    });
  }

  async findAll(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant ID');
    return this.schedules.find(tenantFilter(tenantId, {}))
      .sort({ status: 1, nextRunAt: 1, createdAt: -1 }).lean();
  }

  async setStatus(tenantId: string, id: string, status: 'ACTIVE' | 'PAUSED') {
    this.validateId(tenantId, id);
    const schedule = await this.schedules.findOneAndUpdate(
      tenantFilter(tenantId, { _id: new Types.ObjectId(id), status: { $ne: 'COMPLETED' } }),
      { $set: { status } }, { new: true },
    );
    if (!schedule) throw new NotFoundException('Active recurring expense schedule not found');
    return schedule;
  }

  async runDue(tenantId: string, userId: string, now = new Date()) {
    this.validateIdentity(tenantId, userId);
    const due = await this.schedules.find(tenantFilter(tenantId, {
      status: 'ACTIVE', nextRunAt: { $lte: now },
    })).sort({ nextRunAt: 1 }).limit(50).lean();
    const generated: Array<{ scheduleId: string; expenseId: string; period: string }> = [];
    for (const item of due) {
      const session = await this.schedules.db.startSession();
      try {
        await session.withTransaction(async () => {
          const current = await this.schedules.findOne(tenantFilter(tenantId, {
            _id: item._id, status: 'ACTIVE', nextRunAt: item.nextRunAt,
          })).session(session);
          if (!current) return;
          const period = current.nextRunAt.toISOString().slice(0, 10);
          const [expense] = await this.expenses.create([{
            tenantId: new Types.ObjectId(tenantId), createdBy: current.createdBy,
            title: current.title, category: current.category, description: current.description,
            amount: current.amount, expenseDate: current.nextRunAt,
            payee: current.payee, reference: current.reference,
            status: 'UNPAID', approvalStatus: 'APPROVED', approvalHistory: [],
            paidAmount: 0, dueAmount: current.amount, payments: [],
            recurringScheduleId: current._id, recurringPeriod: period,
          }], { session });
          await this.accounting.postOperationalJournal({
            tenantId, userId, postingDate: current.nextRunAt,
            narration: `Recurring expense: ${current.title}`,
            sourceType: 'EXPENSE', sourceId: expense._id.toString(),
            lines: [
              { accountCode: '5200', debit: current.amount, credit: 0, description: current.category },
              { accountCode: '2000', debit: 0, credit: current.amount, description: current.payee || current.title },
            ],
            session,
          });
          const next = this.advance(current.nextRunAt, current.frequency, current.anchorDay);
          const completed = !!current.endDate && next > current.endDate;
          current.lastGeneratedAt = now;
          current.lastGeneratedPeriod = period;
          current.nextRunAt = next;
          if (completed) current.status = 'COMPLETED';
          await current.save({ session });
          generated.push({ scheduleId: current._id.toString(), expenseId: expense._id.toString(), period });
        });
      } finally {
        await session.endSession();
      }
    }
    return { generatedCount: generated.length, generated, checkedCount: due.length, limit: 50 };
  }

  private advance(date: Date, frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY', anchorDay: number) {
    const months = frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : 12;
    const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
    const day = Math.min(anchorDay, new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate());
    return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
  }

  private paise(value: number) {
    if (!Number.isFinite(value)) throw new BadRequestException('Invalid monetary amount');
    return Math.round((value + Number.EPSILON) * 100);
  }

  private validateIdentity(tenantId: string, userId: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid tenant or user identity');
    }
  }

  private validateId(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid tenant or schedule ID');
    }
  }
}
