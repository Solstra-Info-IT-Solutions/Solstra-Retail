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
import { Purchase, PurchaseDocument } from '../purchases/schemas/purchase.schema';
import { Supplier, SupplierDocument } from '../suppliers/schemas/supplier.schema';

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

    @InjectModel(Purchase.name)
    private readonly purchases: Model<PurchaseDocument>,

    @InjectModel(Supplier.name)
    private readonly suppliers: Model<SupplierDocument>,
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


  async gstr1(tenantId: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const { start, end } = this.resolveRange(dto);
    const [invoices, creditNotes] = await Promise.all([
      this.invoices.find(tenantFilter(tenantId, {
        status: 'ISSUED', invoiceDate: { $gte: start, $lte: end },
      })).select(
        'invoiceNumber invoiceDate customerName customerGstin placeOfSupplyStateCode financialYear items taxableValue cgstTotal sgstTotal igstTotal totalTax grandTotal',
      ).sort({ invoiceDate: 1, invoiceNumber: 1 }).lean(),
      this.creditNotes.find(tenantFilter(tenantId, {
        creditNoteDate: { $gte: start, $lte: end },
      })).select(
        'creditNoteNumber creditNoteDate invoiceId originalInvoiceNumber items taxableValue cgstTotal sgstTotal igstTotal totalTax totalAmount reason',
      ).sort({ creditNoteDate: 1, creditNoteNumber: 1 }).lean(),
    ]);
    const creditInvoiceIds = [...new Set(creditNotes.map((note: any) => String(note.invoiceId)))];
    const linkedInvoices = creditInvoiceIds.length
      ? await this.invoices.find(tenantFilter(tenantId, {
          _id: { $in: creditInvoiceIds.map((id) => new Types.ObjectId(id)) },
        })).select('_id customerGstin placeOfSupplyStateCode').lean()
      : [];
    const linkedById = new Map(linkedInvoices.map((invoice: any) => [String(invoice._id), invoice]));
    const totals = invoices.reduce((sum: any, invoice: any) => ({
      taxableValue: sum.taxableValue + (invoice.taxableValue || 0),
      cgst: sum.cgst + (invoice.cgstTotal || 0),
      sgst: sum.sgst + (invoice.sgstTotal || 0),
      igst: sum.igst + (invoice.igstTotal || 0),
      tax: sum.tax + (invoice.totalTax || 0),
      invoiceValue: sum.invoiceValue + (invoice.grandTotal || 0),
    }), { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, invoiceValue: 0 });
    const creditTotals = creditNotes.reduce((sum: any, note: any) => ({
      taxableValue: sum.taxableValue + (note.taxableValue || 0),
      cgst: sum.cgst + (note.cgstTotal || 0),
      sgst: sum.sgst + (note.sgstTotal || 0),
      igst: sum.igst + (note.igstTotal || 0),
      tax: sum.tax + (note.totalTax || 0),
      noteValue: sum.noteValue + (note.totalAmount || 0),
    }), { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, noteValue: 0 });
    const b2b = invoices.filter((invoice: any) => Boolean(invoice.customerGstin));
    const b2c = invoices.filter((invoice: any) => !invoice.customerGstin);
    return {
      from: start, to: end, currency: 'INR', amountUnit: 'RUPEES',
      basis: 'ISSUED_SALES_INVOICES_AND_DATED_CREDIT_NOTES',
      classificationNote: 'B2C contains all invoices without a customer GSTIN; B2C large/small turnover thresholds and place-of-supply filing rules are not applied.',
      b2b: { invoiceCount: b2b.length, invoices: b2b },
      b2c: { invoiceCount: b2c.length, invoices: b2c },
      creditNotes: creditNotes.map((note: any) => ({
        ...note,
        customerGstin: linkedById.get(String(note.invoiceId))?.customerGstin ?? null,
        placeOfSupplyStateCode: linkedById.get(String(note.invoiceId))?.placeOfSupplyStateCode ?? null,
      })),
      totals: {
        invoice: totals,
        creditNotes: creditTotals,
        net: {
          taxableValue: Math.round((totals.taxableValue - creditTotals.taxableValue) * 100) / 100,
          cgst: Math.round((totals.cgst - creditTotals.cgst) * 100) / 100,
          sgst: Math.round((totals.sgst - creditTotals.sgst) * 100) / 100,
          igst: Math.round((totals.igst - creditTotals.igst) * 100) / 100,
          tax: Math.round((totals.tax - creditTotals.tax) * 100) / 100,
          invoiceValue: Math.round((totals.invoiceValue - creditTotals.noteValue) * 100) / 100,
        },
      },
    };
  }

  async gstr3b(tenantId: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const { start, end } = this.resolveRange(dto);
    const [invoices, creditNotes, purchases] = await Promise.all([
      this.invoices.find(tenantFilter(tenantId, {
        status: 'ISSUED', invoiceDate: { $gte: start, $lte: end },
      })).select('taxableValue cgstTotal sgstTotal igstTotal totalTax').lean(),
      this.creditNotes.find(tenantFilter(tenantId, {
        creditNoteDate: { $gte: start, $lte: end },
      })).select('taxableValue cgstTotal sgstTotal igstTotal totalTax').lean(),
      this.purchases.find(tenantFilter(tenantId, {
        status: { $ne: 'CANCELLED' }, purchaseDate: { $gte: start, $lte: end },
      })).select('supplierId subtotal gstTotal items status purchaseNumber supplierInvoiceNumber purchaseDate').lean(),
    ]);
    const sum = (rows: any[], field: string) => rows.reduce((total, row) => total + (row[field] || 0), 0);
    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const outward = {
      taxableValue: round(sum(invoices, 'taxableValue') - sum(creditNotes, 'taxableValue')),
      cgst: round(sum(invoices, 'cgstTotal') - sum(creditNotes, 'cgstTotal')),
      sgst: round(sum(invoices, 'sgstTotal') - sum(creditNotes, 'sgstTotal')),
      igst: round(sum(invoices, 'igstTotal') - sum(creditNotes, 'igstTotal')),
      totalTax: round(sum(invoices, 'totalTax') - sum(creditNotes, 'totalTax')),
    };
    const inputTax = round(sum(purchases, 'gstTotal'));
    const supplierIds = [...new Set(purchases.map((purchase: any) => String(purchase.supplierId)))];
    const suppliers = supplierIds.length
      ? await this.suppliers.find(tenantFilter(tenantId, {
          _id: { $in: supplierIds.map((id) => new Types.ObjectId(id)) },
        })).select('_id gstin name').lean()
      : [];
    const supplierById = new Map(suppliers.map((supplier: any) => [String(supplier._id), supplier]));
    const purchasesMissingGstin = purchases.filter((purchase: any) =>
      !supplierById.get(String(purchase.supplierId))?.gstin,
    ).length;
    return {
      from: start, to: end, currency: 'INR', amountUnit: 'RUPEES',
      basis: 'ISSUED_SALES_INVOICES_AND_NON_CANCELLED_PURCHASE_RECORDS',
      outwardTaxableSupplies: {
        invoiceCount: invoices.length,
        creditNoteCount: creditNotes.length,
        ...outward,
      },
      inwardSupplies: {
        purchaseCount: purchases.length,
        taxableValue: round(sum(purchases, 'subtotal')),
        grossInputTaxRecorded: inputTax,
        cgst: null, sgst: null, igst: null,
        taxSplitStatus: 'NOT_STORED_ON_PURCHASE_RECORDS',
        purchasesMissingSupplierGstin: purchasesMissingGstin,
        eligibilityStatus: 'UNVERIFIED_REQUIRES_INVOICE_AND_ITC_ELIGIBILITY_REVIEW',
      },
      netTaxPosition: {
        outputTaxAfterCreditNotes: outward.totalTax,
        lessRecordedInputTax: inputTax,
        indicativeNetTax: round(outward.totalTax - inputTax),
        status: 'INDICATIVE_NOT_A_FILE_READY_GSTR3B',
      },
      limitations: [
        'Purchase records currently store one combined GST amount and do not preserve CGST, SGST or IGST split.',
        'Input tax credit eligibility, blocked credits, reverse charge, imports, advances and prior-period adjustments are not represented by the current source records.',
        'Supplier GSTIN is read from the current supplier profile and may not be a historical snapshot from the purchase date.',
      ],
    };
  }

  async hsnSummary(tenantId: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const { start, end } = this.resolveRange(dto);
    const [invoices, creditNotes] = await Promise.all([
      this.invoices.find(tenantFilter(tenantId, {
        status: 'ISSUED', invoiceDate: { $gte: start, $lte: end },
      })).select('items').lean(),
      this.creditNotes.find(tenantFilter(tenantId, {
        creditNoteDate: { $gte: start, $lte: end },
      })).select('invoiceId items').lean(),
    ]);
    const invoiceIds = [...new Set(creditNotes.map((note: any) => String(note.invoiceId)))];
    const originals = invoiceIds.length
      ? await this.invoices.find(tenantFilter(tenantId, {
          _id: { $in: invoiceIds.map((id) => new Types.ObjectId(id)) },
        })).select('_id items').lean()
      : [];
    const originalById = new Map(originals.map((invoice: any) => [String(invoice._id), invoice]));
    const grouped = new Map<string, any>();
    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const add = (item: any, sign: number, originalItem?: any) => {
      const hsnCode = item.hsnCode || originalItem?.hsnCode || '';
      const gstRate = item.gstRate ?? originalItem?.gstRate ?? 0;
      const key = `${hsnCode || 'MISSING'}|${gstRate}`;
      const row = grouped.get(key) ?? {
        hsnCode: hsnCode || null, gstRate, quantity: 0, taxableValue: 0,
        cgst: 0, sgst: 0, igst: 0, totalTax: 0, lineCount: 0,
      };
      row.quantity = round(row.quantity + sign * (item.quantity || 0));
      row.taxableValue = round(row.taxableValue + sign * (item.taxableValue || 0));
      row.cgst = round(row.cgst + sign * (item.cgstAmount || 0));
      row.sgst = round(row.sgst + sign * (item.sgstAmount || 0));
      row.igst = round(row.igst + sign * (item.igstAmount || 0));
      row.totalTax = round(row.totalTax + sign * (item.totalTax || 0));
      row.lineCount += sign;
      grouped.set(key, row);
    };
    for (const invoice of invoices as any[]) {
      for (const item of invoice.items || []) add(item, 1);
    }
    for (const note of creditNotes as any[]) {
      const original = originalById.get(String(note.invoiceId));
      for (const item of note.items || []) {
        const originalItem = original?.items?.[item.lineIndex];
        add(item, -1, originalItem);
      }
    }
    const rows = [...grouped.values()].sort((a, b) =>
      String(a.hsnCode || '').localeCompare(String(b.hsnCode || '')) || a.gstRate - b.gstRate,
    );
    return {
      from: start, to: end, currency: 'INR', amountUnit: 'RUPEES',
      basis: 'INVOICE_ITEMS_LESS_CREDIT_NOTE_ITEMS',
      rows,
      totals: rows.reduce((sum, row) => ({
        quantity: round(sum.quantity + row.quantity),
        taxableValue: round(sum.taxableValue + row.taxableValue),
        cgst: round(sum.cgst + row.cgst),
        sgst: round(sum.sgst + row.sgst),
        igst: round(sum.igst + row.igst),
        totalTax: round(sum.totalTax + row.totalTax),
      }), { quantity: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 }),
      missingHsnLineCount: rows.filter((row) => !row.hsnCode).reduce((sum, row) => sum + Math.max(0, row.lineCount), 0),
    };
  }

  async gstReconciliation(tenantId: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const { start, end } = this.resolveRange(dto);
    const [invoices, creditNotes, purchases, journalRows] = await Promise.all([
      this.invoices.find(tenantFilter(tenantId, {
        status: 'ISSUED', invoiceDate: { $gte: start, $lte: end },
      })).select('totalTax').lean(),
      this.creditNotes.find(tenantFilter(tenantId, {
        creditNoteDate: { $gte: start, $lte: end },
      })).select('totalTax').lean(),
      this.purchases.find(tenantFilter(tenantId, {
        status: { $ne: 'CANCELLED' }, purchaseDate: { $gte: start, $lte: end },
      })).select('gstTotal').lean(),
      this.journals.aggregate([
        { $match: tenantFilter(tenantId, {
          status: 'POSTED', postingDate: { $gte: start, $lte: end },
        }) },
        { $unwind: '$lines' },
        { $match: { 'lines.accountCode': { $in: ['1300', '2100'] } } },
        { $group: {
          _id: '$lines.accountCode',
          debit: { $sum: '$lines.debit' },
          credit: { $sum: '$lines.credit' },
        } },
      ]),
    ]);
    const sum = (rows: any[], field: string) => rows.reduce((total, row) => total + (row[field] || 0), 0);
    const inputLedger = journalRows.find((row: any) => row._id === '1300');
    const outputLedger = journalRows.find((row: any) => row._id === '2100');
    const sourceInput = sum(purchases, 'gstTotal');
    const sourceOutput = sum(invoices, 'totalTax') - sum(creditNotes, 'totalTax');
    const ledgerInput = (inputLedger?.debit || 0) - (inputLedger?.credit || 0);
    const ledgerOutput = (outputLedger?.credit || 0) - (outputLedger?.debit || 0);
    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    return {
      from: start, to: end, currency: 'INR', amountUnit: 'RUPEES',
      basis: 'SOURCE_DOCUMENTS_VS_POSTED_GST_CONTROL_ACCOUNTS',
      inputTax: {
        sourcePurchaseTax: round(sourceInput), ledgerNetDebit: round(ledgerInput),
        difference: round(sourceInput - ledgerInput),
        reconciled: Math.abs(sourceInput - ledgerInput) < 0.01,
      },
      outputTax: {
        sourceInvoiceTaxLessCreditNotes: round(sourceOutput), ledgerNetCredit: round(ledgerOutput),
        difference: round(sourceOutput - ledgerOutput),
        reconciled: Math.abs(sourceOutput - ledgerOutput) < 0.01,
      },
      note: 'Differences can arise when a source document is cancelled or reversed in a different accounting period; review the underlying journals before filing.',
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
    const byId = new Map<string, any>(grouped.map((row: any) => [String(row._id.accountId), row] as [string, any]));
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

  async cashFlowStatement(tenantId: string, dto: ReportDateRangeDto) {
    this.validateTenant(tenantId);
    const { start, end } = this.resolveRange(dto);
    const cashCodes = ['1000', '1010'];

    const [openingRows, periodEntries, accounts] = await Promise.all([
      this.journals.aggregate([
        { $match: tenantFilter(tenantId, { status: 'POSTED', postingDate: { $lt: start } }) },
        { $unwind: '$lines' },
        { $match: { 'lines.accountCode': { $in: cashCodes } } },
        { $group: {
          _id: null,
          debit: { $sum: '$lines.debit' },
          credit: { $sum: '$lines.credit' },
        } },
      ]),
      this.journals.aggregate([
        { $match: tenantFilter(tenantId, { status: 'POSTED', postingDate: { $gte: start, $lte: end } }) },
        { $project: {
          entryNumber: 1, postingDate: 1, narration: 1, sourceType: 1,
          lines: 1,
        } },
        { $sort: { postingDate: 1, entryNumber: 1 } },
      ]),
      this.accounts.find(tenantFilter(tenantId, { isActive: true }))
        .select('code name type').lean(),
    ]);

    const accountByCode = new Map(accounts.map((account: any) => [account.code, account]));
    const totals = {
      operating: { inflows: 0, outflows: 0 },
      investing: { inflows: 0, outflows: 0 },
      financing: { inflows: 0, outflows: 0 },
      unclassified: { inflows: 0, outflows: 0 },
    };
    const unclassifiedAccounts = new Map<string, { code: string; name: string; inflows: number; outflows: number }>();
    let cashInflows = 0;
    let cashOutflows = 0;

    const classify = (code: string, type?: string): keyof typeof totals => {
      if (type === 'EQUITY') return 'financing';
      if (type === 'ASSET') {
        if (/^(11|12|13|14)\d{2}$/.test(code)) return 'operating';
        return 'investing';
      }
      if (type === 'LIABILITY') {
        if (/^(20|21|22)\d{2}$/.test(code)) return 'operating';
        return 'financing';
      }
      if (type === 'INCOME' || type === 'EXPENSE') return 'operating';
      return 'unclassified';
    };

    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    for (const entry of periodEntries as any[]) {
      const cashDebit = round(entry.lines
        .filter((line: any) => cashCodes.includes(line.accountCode))
        .reduce((sum: number, line: any) => sum + line.debit, 0));
      const cashCredit = round(entry.lines
        .filter((line: any) => cashCodes.includes(line.accountCode))
        .reduce((sum: number, line: any) => sum + line.credit, 0));
      const net = round(cashDebit - cashCredit);
      if (net === 0) continue;

      cashInflows += Math.max(0, net);
      cashOutflows += Math.max(0, -net);

      const counterpartLines = entry.lines.filter((line: any) => !cashCodes.includes(line.accountCode));
      const side = net > 0 ? 'credit' : 'debit';
      const candidateLines = counterpartLines.filter((line: any) => line[side] > 0);
      const candidateTotal = candidateLines.reduce((sum: number, line: any) => sum + line[side], 0);
      const amount = Math.abs(net);
      let allocated = 0;

      candidateLines.forEach((line: any, index: number) => {
        const account = accountByCode.get(line.accountCode);
        const category = classify(line.accountCode, account?.type);
        const share = index === candidateLines.length - 1
          ? round(amount - allocated)
          : round(amount * (line[side] / (candidateTotal || amount)));
        allocated = round(allocated + share);
        if (share <= 0) return;
        if (net > 0) totals[category].inflows = round(totals[category].inflows + share);
        else totals[category].outflows = round(totals[category].outflows + share);

        if (category === 'unclassified') {
          const key = line.accountCode;
          const detail = unclassifiedAccounts.get(key) ?? {
            code: line.accountCode, name: line.accountName, inflows: 0, outflows: 0,
          };
          if (net > 0) detail.inflows = round(detail.inflows + share);
          else detail.outflows = round(detail.outflows + share);
          unclassifiedAccounts.set(key, detail);
        }
      });

      const residual = round(amount - allocated);
      if (residual > 0) {
        if (net > 0) totals.unclassified.inflows = round(totals.unclassified.inflows + residual);
        else totals.unclassified.outflows = round(totals.unclassified.outflows + residual);
      }
    }

    const openingBalance = round((openingRows[0]?.debit ?? 0) - (openingRows[0]?.credit ?? 0));
    const netOperating = round(totals.operating.inflows - totals.operating.outflows);
    const netInvesting = round(totals.investing.inflows - totals.investing.outflows);
    const netFinancing = round(totals.financing.inflows - totals.financing.outflows);
    const netUnclassified = round(totals.unclassified.inflows - totals.unclassified.outflows);
    const netMovement = round(cashInflows - cashOutflows);
    const closingBalance = round(openingBalance + netMovement);

    return {
      from: start,
      to: end,
      currency: 'INR',
      amountUnit: 'RUPEES',
      basis: 'POSTED_JOURNAL_ENTRIES',
      method: 'DIRECT',
      cashAccounts: cashCodes,
      openingCashAndBank: openingBalance,
      operating: { ...totals.operating, net: netOperating },
      investing: { ...totals.investing, net: netInvesting },
      financing: { ...totals.financing, net: netFinancing },
      unclassified: {
        ...totals.unclassified,
        net: netUnclassified,
        accounts: [...unclassifiedAccounts.values()].sort((a, b) => a.code.localeCompare(b.code)),
      },
      netCashMovement: netMovement,
      closingCashAndBank: closingBalance,
      reconciliation: {
        journalCashMovement: netMovement,
        classifiedMovement: round(netOperating + netInvesting + netFinancing + netUnclassified),
        difference: round(netMovement - netOperating - netInvesting - netFinancing - netUnclassified),
        reconciled: Math.abs(netMovement - netOperating - netInvesting - netFinancing - netUnclassified) < 0.01,
      },
      generatedAt: new Date(),
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


