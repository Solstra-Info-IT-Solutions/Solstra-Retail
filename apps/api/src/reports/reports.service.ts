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
}


