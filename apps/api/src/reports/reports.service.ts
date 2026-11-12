import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { tenantFilter } from '../common/tenant-scoped.service';
import {
  Product,
  ProductDocument,
} from '../products/schemas/product.schema';
import {
  SalesInvoice,
  SalesInvoiceDocument,
} from '../sales/schemas/sales-invoice.schema';
import {
  CreditNote,
  CreditNoteDocument,
} from '../sales/schemas/credit-note.schema';
import {
  InventoryMovement,
  InventoryMovementDocument,
} from '../inventory/schemas/inventory-movement.schema';
import { ReportDateRangeDto } from './dto/report-date-range.dto';
import { Account, AccountDocument } from '../accounting/schemas/account.schema';
import { JournalEntry, JournalEntryDocument } from '../accounting/schemas/journal-entry.schema';

type DateRange = {
  start: Date;
  end: Date;
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(SalesInvoice.name)
    private readonly invoices: Model<SalesInvoiceDocument>,

    @InjectModel(CreditNote.name)
    private readonly creditNotes: Model<CreditNoteDocument>,

    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,

    @InjectModel(InventoryMovement.name)
    private readonly movements: Model<InventoryMovementDocument>,

    @InjectModel(Account.name)
    private readonly accounts: Model<AccountDocument>,

    @InjectModel(JournalEntry.name)
    private readonly journals: Model<JournalEntryDocument>,
  ) {}

  private resolveRange(dto: ReportDateRangeDto): DateRange {
    const now = new Date();

    const parseLocalDate = (value: string): Date => {
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(year, month - 1, day);

      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        throw new BadRequestException('Invalid report calendar date');
      }

      return date;
    };

    const start = dto.from
      ? parseLocalDate(dto.from)
      : new Date(now.getFullYear(), now.getMonth(), 1);

    const end = dto.to
      ? parseLocalDate(dto.to)
      : new Date(now);

    if (dto.to) {
      end.setHours(23, 59, 59, 999);
    }

    if (start > end) {
      throw new BadRequestException('Report start date cannot be after end date');
    }

    return { start, end };
  }

  private async sumCreditNotes(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const result = await this.creditNotes.aggregate([
      {
        $match: tenantFilter(tenantId, {
          creditNoteDate: { $gte: start, $lte: end },
        }),
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' },
        },
      },
    ]);

    return result[0]?.total ?? 0;
  }

  private async sumRefunds(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const result = await this.creditNotes.aggregate([
      {
        $match: tenantFilter(tenantId, {
          'refunds.refundedAt': { $gte: start, $lte: end },
        }),
      },
      { $unwind: '$refunds' },
      {
        $match: {
          'refunds.refundedAt': { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$refunds.amount' },
        },
      },
    ]);

    return result[0]?.total ?? 0;
  }

  async dashboardSummary(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('Invalid tenant context');
    }

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    );

    const issuedFilter = {
      status: 'ISSUED',
    };

    const [
      todaySales,
      monthlySales,
      outstanding,
      todayCollections,
      todayRefunds,
      todayCredits,
      monthlyCredits,
      lowStockCount,
      inventoryValuation,
    ] = await Promise.all([
      this.invoices.aggregate([
        {
          $match: tenantFilter(tenantId, {
            ...issuedFilter,
            invoiceDate: { $gte: todayStart, $lte: now },
          }),
        },
        {
          $group: {
            _id: null,
            invoiceCount: { $sum: 1 },
            grossSalesRupees: { $sum: '$grandTotal' },
          },
        },
      ]),

      this.invoices.aggregate([
        {
          $match: tenantFilter(tenantId, {
            ...issuedFilter,
            invoiceDate: { $gte: monthStart, $lte: now },
          }),
        },
        {
          $group: {
            _id: null,
            invoiceCount: { $sum: 1 },
            grossSalesRupees: { $sum: '$grandTotal' },
          },
        },
      ]),

      this.invoices.aggregate([
        {
          $match: tenantFilter(tenantId, issuedFilter),
        },
        {
          $group: {
            _id: null,
            outstandingRupees: { $sum: '$dueAmount' },
          },
        },
      ]),

      this.invoices.aggregate([
        {
          $match: tenantFilter(tenantId, {
            'payments.paidAt': {
              $gte: todayStart,
              $lte: now,
            },
          }),
        },
        { $unwind: '$payments' },
        {
          $match: {
            'payments.paidAt': {
              $gte: todayStart,
              $lte: now,
            },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$payments.amount' },
          },
        },
      ]),

      this.sumRefunds(tenantId, todayStart, now),
      this.sumCreditNotes(tenantId, todayStart, now),
      this.sumCreditNotes(tenantId, monthStart, now),

      this.products.countDocuments(
        tenantFilter(tenantId, {
          isDeleted: false,
          trackStock: true,
          $expr: {
            $lte: ['$stockQty', '$lowStockThreshold'],
          },
        }),
      ),

      this.products.aggregate([
        {
          $match: tenantFilter(tenantId, {
            isDeleted: false,
            trackStock: true,
          }),
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $multiply: ['$purchasePrice', '$stockQty'],
              },
            },
            productCount: { $sum: 1 },
            totalUnits: { $sum: '$stockQty' },
          },
        },
      ]),
    ]);

    const todayGross = todaySales[0]?.grossSalesRupees ?? 0;
    const monthGross = monthlySales[0]?.grossSalesRupees ?? 0;

    return {
      generatedAt: now,
      currency: 'INR',
      amountUnit: 'RUPEES',
      today: {
        invoiceCount: todaySales[0]?.invoiceCount ?? 0,
        grossSalesRupees: todayGross,
        creditNotesRupees: todayCredits,
        netSalesRupees: todayGross - todayCredits,
        collectionsRupees: todayCollections[0]?.total ?? 0,
        refundsRupees: todayRefunds,
      },
      month: {
        invoiceCount: monthlySales[0]?.invoiceCount ?? 0,
        grossSalesRupees: monthGross,
        creditNotesRupees: monthlyCredits,
        netSalesRupees: monthGross - monthlyCredits,
      },
      outstandingDuesRupees:
        outstanding[0]?.outstandingRupees ?? 0,
      lowStockProductCount: lowStockCount,
      inventory: {
        productCount: inventoryValuation[0]?.productCount ?? 0,
        totalUnits: inventoryValuation[0]?.totalUnits ?? 0,
        valuationAtPurchaseCostRupees:
          inventoryValuation[0]?.total ?? 0,
      },
    };
  }

  async salesReport(
    tenantId: string,
    dto: ReportDateRangeDto,
  ) {
    const { start, end } = this.resolveRange(dto);

    const invoiceMatch = tenantFilter(tenantId, {
      status: 'ISSUED',
      invoiceDate: { $gte: start, $lte: end },
    });

    const [
      summary,
      creditNotesRupees,
      refundsRupees,
      paymentMethods,
      topProducts,
    ] = await Promise.all([
      this.invoices.aggregate([
        { $match: invoiceMatch },
        {
          $group: {
            _id: null,
            invoiceCount: { $sum: 1 },
            subtotalRupees: { $sum: '$subtotal' },
            discountRupees: { $sum: '$discountTotal' },
            taxableValueRupees: { $sum: '$taxableValue' },
            cgstRupees: { $sum: '$cgstTotal' },
            sgstRupees: { $sum: '$sgstTotal' },
            igstRupees: { $sum: '$igstTotal' },
            totalTaxRupees: { $sum: '$totalTax' },
            grossSalesRupees: { $sum: '$grandTotal' },
          },
        },
      ]),

      this.sumCreditNotes(tenantId, start, end),
      this.sumRefunds(tenantId, start, end),

      this.invoices.aggregate([
        {
          $match: tenantFilter(tenantId, {
            'payments.paidAt': { $gte: start, $lte: end },
          }),
        },
        { $unwind: '$payments' },
        {
          $match: {
            'payments.paidAt': { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: '$payments.method',
            amountRupees: { $sum: '$payments.amount' },
            paymentCount: { $sum: 1 },
          },
        },
        { $sort: { amountRupees: -1 } },
      ]),

      this.invoices.aggregate([
        { $match: invoiceMatch },
        { $unwind: '$items' },
        {
          $group: {
            _id: {
              productId: '$items.productId',
              name: '$items.name',
              sku: '$items.sku',
            },
            quantitySold: { $sum: '$items.quantity' },
            revenueRupees: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { quantitySold: -1, revenueRupees: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            productId: '$_id.productId',
            name: '$_id.name',
            sku: '$_id.sku',
            quantitySold: 1,
            revenueRupees: 1,
          },
        },
      ]),
    ]);

    const totals = summary[0] ?? {
      invoiceCount: 0,
      subtotalRupees: 0,
      discountRupees: 0,
      taxableValueRupees: 0,
      cgstRupees: 0,
      sgstRupees: 0,
      igstRupees: 0,
      totalTaxRupees: 0,
      grossSalesRupees: 0,
    };

    return {
      from: start,
      to: end,
      currency: 'INR',
      amountUnit: 'RUPEES',
      ...totals,
      creditNotesRupees,
      netSalesRupees: totals.grossSalesRupees - creditNotesRupees,
      refundsRupees,
      paymentMethods,
      topProducts,
    };
  }

  async inventoryReport(
    tenantId: string,
    dto: ReportDateRangeDto,
  ) {
    const { start, end } = this.resolveRange(dto);

    const [
      stockSummary,
      lowStockProducts,
      movementSummary,
    ] = await Promise.all([
      this.products.aggregate([
        {
          $match: tenantFilter(tenantId, {
            isDeleted: false,
            trackStock: true,
          }),
        },
        {
          $group: {
            _id: null,
            productCount: { $sum: 1 },
            totalUnits: { $sum: '$stockQty' },
            valuationAtPurchaseCostRupees: {
              $sum: {
                $multiply: ['$purchasePrice', '$stockQty'],
              },
            },
            valuationAtSellingPriceRupees: {
              $sum: {
                $multiply: ['$sellingPrice', '$stockQty'],
              },
            },
          },
        },
      ]),

      this.products.find(
        tenantFilter(tenantId, {
          isDeleted: false,
          trackStock: true,
          $expr: {
            $lte: ['$stockQty', '$lowStockThreshold'],
          },
        }),
      )
        .select('name sku stockQty lowStockThreshold unit')
        .sort({ stockQty: 1 })
        .limit(50)
        .lean(),

      this.movements.aggregate([
        {
          $match: tenantFilter(tenantId, {
            createdAt: { $gte: start, $lte: end },
          }),
        },
        {
          $group: {
            _id: '$type',
            movementCount: { $sum: 1 },
            quantityDelta: { $sum: '$quantityDelta' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return {
      from: start,
      to: end,
      currency: 'INR',
      amountUnit: 'RUPEES',
      stock: stockSummary[0] ?? {
        productCount: 0,
        totalUnits: 0,
        valuationAtPurchaseCostRupees: 0,
        valuationAtSellingPriceRupees: 0,
      },
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
      movementSummary,
    };
  }

  private validateTenant(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('Invalid tenant context');
    }
  }

  private async accountBalances(tenantId: string, through: Date, from?: Date) {
    const dateMatch: Record<string, unknown> = { $lte: through };
    if (from) dateMatch.$gte = from;
    const [accounts, grouped] = await Promise.all([
      this.accounts.find(tenantFilter(tenantId, { isActive: true })).sort({ code: 1 }).lean(),
      this.journals.aggregate([
        { $match: tenantFilter(tenantId, { status: 'POSTED', postingDate: dateMatch }) },
        { $unwind: '$lines' },
        { $group: {
          _id: { accountId: '$lines.accountId', code: '$lines.accountCode', name: '$lines.accountName' },
          debit: { $sum: '$lines.debit' },
          credit: { $sum: '$lines.credit' },
          entries: { $sum: 1 },
        } },
      ]),
    ]);
    const byId = new Map(grouped.map((row: any) => [String(row._id.accountId), row]));
    return accounts.map((account: any) => {
      const row: any = byId.get(String(account._id));
      const debit = Math.round((row?.debit ?? 0) * 100) / 100;
      const credit = Math.round((row?.credit ?? 0) * 100) / 100;
      const debitNormal = account.type === 'ASSET' || account.type === 'EXPENSE';
      const net = Math.round((debit - credit) * 100) / 100;
      return {
        accountId: account._id, code: account.code, name: account.name, type: account.type,
        debit, credit, balance: Math.abs(net),
        balanceSide: net === 0 ? 'ZERO' : ((net > 0) === debitNormal ? 'DEBIT' : 'CREDIT'),
        entryLineCount: row?.entries ?? 0,
      };
    });
  }

  async trialBalance(tenantId: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const { start, end } = this.resolveRange(dto);
    const balances = await this.accountBalances(tenantId, end);
    const totals = balances.reduce((sum, row) => {
      if (row.balanceSide === 'DEBIT') sum.debit += row.balance;
      if (row.balanceSide === 'CREDIT') sum.credit += row.balance;
      return sum;
    }, { debit: 0, credit: 0 });
    const debit = Math.round(totals.debit * 100) / 100;
    const credit = Math.round(totals.credit * 100) / 100;
    return {
      from: start, to: end, asOf: end, currency: 'INR', amountUnit: 'RUPEES',
      accounts: balances,
      totals: { debit, credit, difference: Math.round((debit - credit) * 100) / 100 },
      balanced: Math.abs(debit - credit) < 0.01,
      basis: 'POSTED_JOURNAL_ENTRIES',
    };
  }

  async generalLedger(tenantId: string, accountCode: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const code = accountCode?.trim().toUpperCase();
    if (!code) throw new BadRequestException('Account code is required');
    const { start, end } = this.resolveRange(dto);
    const account = await this.accounts.findOne(tenantFilter(tenantId, { code, isActive: true })).lean();
    if (!account) throw new BadRequestException('Account not found for this business');
    const [openingRows, entries] = await Promise.all([
      this.journals.aggregate([
        { $match: tenantFilter(tenantId, { status: 'POSTED', postingDate: { $lt: start } }) },
        { $unwind: '$lines' },
        { $match: { 'lines.accountCode': code } },
        { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
      ]),
      this.journals.aggregate([
        { $match: tenantFilter(tenantId, { status: 'POSTED', postingDate: { $gte: start, $lte: end } }) },
        { $unwind: '$lines' },
        { $match: { 'lines.accountCode': code } },
        { $sort: { postingDate: 1, entryNumber: 1 } },
        { $project: {
          _id: 0, journalId: '$_id', entryNumber: 1, postingDate: 1, narration: 1,
          sourceType: 1, sourceId: 1, debit: '$lines.debit', credit: '$lines.credit',
          description: '$lines.description',
        } },
      ]),
    ]);
    const openingDebit = openingRows[0]?.debit ?? 0;
    const openingCredit = openingRows[0]?.credit ?? 0;
    const debitNormal = account.type === 'ASSET' || account.type === 'EXPENSE';
    let running = Math.round((openingDebit - openingCredit) * 100) / 100;
    const openingBalance = Math.abs(running);
    const openingSide = running === 0 ? 'ZERO' : ((running > 0) === debitNormal ? 'DEBIT' : 'CREDIT');
    const rows = entries.map((entry: any) => {
      running = Math.round((running + entry.debit - entry.credit) * 100) / 100;
      return { ...entry, runningBalance: Math.abs(running),
        balanceSide: running === 0 ? 'ZERO' : ((running > 0) === debitNormal ? 'DEBIT' : 'CREDIT') };
    });
    return {
      from: start, to: end, currency: 'INR', account: { code: account.code, name: account.name, type: account.type },
      opening: { balance: openingBalance, side: openingSide },
      entries: rows,
      closing: { balance: Math.abs(running), side: running === 0 ? 'ZERO' : ((running > 0) === debitNormal ? 'DEBIT' : 'CREDIT') },
      totals: {
        debit: Math.round(rows.reduce((s: number, row: any) => s + row.debit, 0) * 100) / 100,
        credit: Math.round(rows.reduce((s: number, row: any) => s + row.credit, 0) * 100) / 100,
      },
    };
  }

  async cashBankBook(tenantId: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const { start, end } = this.resolveRange(dto);
    const accounts = await this.accounts.find(tenantFilter(tenantId, {
      code: { $in: ['1000', '1010'] }, isActive: true,
    })).lean();
    const localDate = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const books = await Promise.all(accounts.map((account: any) =>
      this.generalLedger(tenantId, account.code, { from: dto.from ?? localDate(start), to: dto.to ?? localDate(end) }),
    ));
    return { from: start, to: end, currency: 'INR', books };
  }

  async profitAndLoss(tenantId: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const { start, end } = this.resolveRange(dto);
    const balances = await this.accountBalances(tenantId, end, start);
    const income = balances.filter(row => row.type === 'INCOME');
    const expenses = balances.filter(row => row.type === 'EXPENSE');
    const incomeTotal = Math.round(income.reduce((s, row) => s + (row.balanceSide === 'CREDIT' ? row.balance : -row.balance), 0) * 100) / 100;
    const expenseTotal = Math.round(expenses.reduce((s, row) => s + (row.balanceSide === 'DEBIT' ? row.balance : -row.balance), 0) * 100) / 100;
    return {
      from: start, to: end, currency: 'INR', basis: 'POSTED_JOURNAL_ENTRIES',
      income, expenses, totalIncome: incomeTotal, totalExpenses: expenseTotal,
      netProfit: Math.round((incomeTotal - expenseTotal) * 100) / 100,
    };
  }

  async balanceSheet(tenantId: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const { start, end } = this.resolveRange(dto);
    const balances = await this.accountBalances(tenantId, end);
    const assets = balances.filter(row => row.type === 'ASSET');
    const liabilities = balances.filter(row => row.type === 'LIABILITY');
    const equityAccounts = balances.filter(row => row.type === 'EQUITY');
    const income = balances.filter(row => row.type === 'INCOME');
    const expenses = balances.filter(row => row.type === 'EXPENSE');
    const sumSide = (rows: typeof balances, side: 'DEBIT' | 'CREDIT') =>
      Math.round(rows.reduce((s, row) => s + (row.balanceSide === side ? row.balance : 0), 0) * 100) / 100;
    const totalAssets = sumSide(assets, 'DEBIT') - sumSide(assets, 'CREDIT');
    const totalLiabilities = sumSide(liabilities, 'CREDIT') - sumSide(liabilities, 'DEBIT');
    const totalEquityAccounts = sumSide(equityAccounts, 'CREDIT') - sumSide(equityAccounts, 'DEBIT');
    const cumulativeIncome = sumSide(income, 'CREDIT') - sumSide(income, 'DEBIT');
    const cumulativeExpenses = sumSide(expenses, 'DEBIT') - sumSide(expenses, 'CREDIT');
    const retainedEarningsToDate = Math.round((cumulativeIncome - cumulativeExpenses) * 100) / 100;
    const totalEquity = Math.round((totalEquityAccounts + retainedEarningsToDate) * 100) / 100;
    const totalLiabilitiesAndEquity = Math.round((totalLiabilities + totalEquity) * 100) / 100;
    return {
      asOf: end, currency: 'INR', basis: 'POSTED_JOURNAL_ENTRIES',
      assets, liabilities, equity: equityAccounts,
      retainedEarningsToDate, totalAssets: Math.round(totalAssets * 100) / 100,
      totalLiabilities: Math.round(totalLiabilities * 100) / 100,
      totalEquity, totalLiabilitiesAndEquity,
      difference: Math.round((totalAssets - totalLiabilitiesAndEquity) * 100) / 100,
      balanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01,
    };
  }

}


