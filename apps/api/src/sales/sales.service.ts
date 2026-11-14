import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { Product } from '../products/schemas/product.schema';
import { Customer, CustomerDocument } from '../customers/schemas/customer.schema';
import { Tenant } from '../tenants/schemas/tenant.schema';
import { InventoryMovement } from '../inventory/schemas/inventory-movement.schema';
import { Warehouse } from '../branches/schemas/warehouse.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { WarehouseStock, WarehouseStockDocument } from '../inventory/schemas/warehouse-stock.schema';
import { tenantFilter } from '../common/tenant-scoped.service';

import { SalesInvoice } from './schemas/sales-invoice.schema';
import { InvoiceCounter } from './schemas/invoice-counter.schema';
import { CreditNote } from './schemas/credit-note.schema';
import { CreditNoteCounter } from './schemas/credit-note-counter.schema';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesDto } from './dto/list-sales.dto';
import { AddSalePaymentDto } from './dto/add-sale-payment.dto';
import { AddCreditNoteRefundDto } from './dto/add-credit-note-refund.dto';
import { AccountingService } from '../accounting/accounting.service';
import { TaxPeriodsService } from '../accounting/tax-periods.service';

@Injectable()
export class SalesService {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,

    @InjectModel(Product.name)
    private readonly products: Model<Product>,

    @InjectModel(Customer.name)
    private readonly customers: Model<CustomerDocument>,

    @InjectModel(Tenant.name)
    private readonly tenants: Model<Tenant>,

    @InjectModel(InventoryMovement.name)
    private readonly movements: Model<InventoryMovement>,

    @InjectModel(SalesInvoice.name)
    private readonly invoices: Model<SalesInvoice>,

    @InjectModel(InvoiceCounter.name)
    private readonly counters: Model<InvoiceCounter>,

    @InjectModel(CreditNote.name)
    private readonly creditNotes: Model<CreditNote>,

    @InjectModel(CreditNoteCounter.name)
    private readonly creditNoteCounters: Model<CreditNoteCounter>,

    private readonly accounting: AccountingService,
    private readonly taxPeriods: TaxPeriodsService,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<Warehouse>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    @InjectModel(WarehouseStock.name) private readonly warehouseStocks: Model<WarehouseStockDocument>,
  ) {}

  private toPaise(value: number): number {
    return Math.round((value + Number.EPSILON) * 100);
  }

  private fromPaise(value: number): number {
    return value / 100;
  }

  private financialYear(date: Date): string {
    const indiaDate = new Date(date.getTime() + 330 * 60 * 1000);
    const month = indiaDate.getUTCMonth();
    const year = indiaDate.getUTCFullYear();
    const startYear = month >= 3 ? year : year - 1;

    return `${startYear}-${String(startYear + 1).slice(-2)}`;
  }

  private async ensureInvoiceCounter(
    tenantId: string,
    financialYear: string,
  ): Promise<void> {
    const filter = {
      tenantId: new Types.ObjectId(tenantId),
      financialYear,
    };

    try {
      await this.counters.updateOne(
        filter,
        {
          $setOnInsert: { sequence: 0 },
        },
        {
          upsert: true,
          setDefaultsOnInsert: true,
        },
      );
    } catch (error) {
      const mongoError = error as { code?: number };

      if (mongoError.code !== 11000) {
        throw error;
      }

      const existing = await this.counters.exists(filter);

      if (!existing) {
        throw error;
      }
    }
  }

  private async nextInvoiceNumber(
    tenantId: string,
    financialYear: string,
    session: any,
  ): Promise<string> {
    const counter = await this.counters.findOneAndUpdate(
      {
        tenantId: new Types.ObjectId(tenantId),
        financialYear,
      },
      {
        $inc: { sequence: 1 },
      },
      {
        new: true,
        session,
      },
    );

    if (!counter) {
      throw new ConflictException(
        'Invoice counter is not initialized. Please retry the sale.',
      );
    }

    return `SR/${financialYear}/${String(counter.sequence).padStart(6, '0')}`;
  }

  private async ensureCreditNoteCounter(
    tenantId: string,
    financialYear: string,
  ): Promise<void> {
    const filter = {
      tenantId: new Types.ObjectId(tenantId),
      financialYear,
    };

    try {
      await this.creditNoteCounters.updateOne(
        filter,
        { $setOnInsert: { sequence: 0 } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    } catch (error) {
      const mongoError = error as { code?: number };

      if (mongoError.code !== 11000) {
        throw error;
      }

      const existing = await this.creditNoteCounters.exists(filter);

      if (!existing) {
        throw error;
      }
    }
  }

  private async nextCreditNoteNumber(
    tenantId: string,
    financialYear: string,
    session: any,
  ): Promise<string> {
    const counter = await this.creditNoteCounters.findOneAndUpdate(
      {
        tenantId: new Types.ObjectId(tenantId),
        financialYear,
      },
      { $inc: { sequence: 1 } },
      { new: true, session },
    );

    if (!counter) {
      throw new ConflictException(
        'Credit-note counter is not initialized. Please retry.',
      );
    }

    return `CN/${financialYear}/${String(counter.sequence).padStart(6, '0')}`;
  }
  async createSale(
    tenantId: string,
    userId: string,
    dto: CreateSaleDto,
  ) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new BadRequestException('Invalid tenant or user identity.');
    }

    const idempotencyKey = dto.idempotencyKey.trim().toLowerCase();

    const fingerprintPayload = {
      items: dto.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        discountAmount: item.discountAmount ?? 0,
      })),
      customerId: dto.customerId ?? null,
      customerName: dto.customerName ?? '',
      customerPhone: dto.customerPhone ?? '',
      customerGstin: dto.customerGstin ?? null,
      placeOfSupplyStateCode: dto.placeOfSupplyStateCode,
      ...(dto.warehouseId ? { warehouseId: dto.warehouseId } : {}),
      payments: (dto.payments ?? []).map((payment) => ({
        method: payment.method,
        amountPaise: this.toPaise(payment.amount),
        reference: payment.reference ?? '',
      })),
    };

    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify(fingerprintPayload))
      .digest('hex');

    const existingInvoice = await this.invoices
      .findOne(tenantFilter(tenantId, { idempotencyKey }))
      .lean();

    if (existingInvoice) {
      if (existingInvoice.requestFingerprint !== requestFingerprint) {
        throw new ConflictException(
          'This idempotency key has already been used for a different sale.',
        );
      }

      return existingInvoice;
    }
    const saleDate = new Date();
    const fy = this.financialYear(saleDate);

    await this.ensureInvoiceCounter(tenantId, fy);

    const session = await this.connection.startSession();

    try {
      let result: any;

      await session.withTransaction(async () => {
        const transactionDuplicate = await this.invoices
          .findOne(tenantFilter(tenantId, { idempotencyKey }))
          .session(session)
          .lean();

        if (transactionDuplicate) {
          if (transactionDuplicate.requestFingerprint !== requestFingerprint) {
            throw new ConflictException(
              'This idempotency key has already been used for a different sale.',
            );
          }

          result = transactionDuplicate;
          return;
        }
        await this.taxPeriods.assertOpen(tenantId, saleDate, session);
        const tenant = await this.tenants
          .findById(tenantId)
          .session(session)
          .lean();

        if (!tenant) {
          throw new NotFoundException('Business profile not found.');
        }

        if (!tenant.stateCode) {
          throw new BadRequestException(
            'Configure the business state code in the tenant profile before creating invoices.',
          );
        }

        const linkedCustomer = dto.customerId
          ? await this.customers
              .findOne(
                tenantFilter(tenantId, {
                  _id: new Types.ObjectId(dto.customerId),
                  isDeleted: false,
                }),
              )
              .session(session)
              .lean()
          : null;

        if (dto.customerId && !linkedCustomer) {
          throw new NotFoundException('Customer not found in this business.');
        }

        const customerName = linkedCustomer?.name ?? dto.customerName ?? '';
        const customerPhone = linkedCustomer?.phone ?? dto.customerPhone ?? '';
        const customerGstin = linkedCustomer?.gstin ?? dto.customerGstin ?? null;

        const sellerGstin = tenant.gstin || null;
        const sellerStateCode = tenant.stateCode;
        const placeOfSupply = dto.placeOfSupplyStateCode;

        if (
          customerGstin && customerGstin.substring(0, 2) !== placeOfSupply
        ) {
          throw new BadRequestException(
            'Customer GSTIN state code must match the place-of-supply state code.',
          );
        }

        if (sellerGstin && sellerGstin.substring(0, 2) !== sellerStateCode) {
          throw new BadRequestException(
            'Seller GSTIN state code does not match the business state code.',
          );
        }

        const productMap = new Map<string, any>();
        const requestedQuantities = new Map<string, number>();

        for (const item of dto.items) {
          const id = item.productId;

          requestedQuantities.set(
            id,
            (requestedQuantities.get(id) || 0) + item.quantity,
          );
        }

        for (const productId of requestedQuantities.keys()) {
          const product = await this.products
            .findOne(
              tenantFilter(tenantId, {
                _id: new Types.ObjectId(productId),
                isDeleted: false,
              }),
            )
            .session(session)
            .lean();

          if (!product) {
            throw new NotFoundException(
              `Product ${productId} was not found in this business.`,
            );
          }

          productMap.set(productId, product);
        }

        let selectedWarehouse: any = null;
        const warehouseStockMap = new Map<string, any>();
        if (dto.warehouseId) {
          if (!Types.ObjectId.isValid(dto.warehouseId)) throw new BadRequestException('Invalid warehouse ID');
          selectedWarehouse = await this.warehouses.findOne(tenantFilter(tenantId, {
            _id: new Types.ObjectId(dto.warehouseId), isDeleted: false, isActive: true,
          })).session(session).lean();
          if (!selectedWarehouse) throw new NotFoundException('Active warehouse not found in this business');
          const branch = await this.branches.findOne(tenantFilter(tenantId, {
            _id: selectedWarehouse.branchId, isDeleted: false, isActive: true,
          })).session(session).lean();
          if (!branch) throw new ConflictException('The selected warehouse branch is inactive');
          const stockRows = await this.warehouseStocks.find(tenantFilter(tenantId, {
            warehouseId: selectedWarehouse._id,
            productId: { $in: Array.from(productMap.values()).map((product: any) => product._id) },
          })).session(session).lean();
          for (const stock of stockRows) warehouseStockMap.set(String(stock.productId), stock);
        }

        const now = saleDate;
        const invoiceNumber = await this.nextInvoiceNumber(
          tenantId,
          fy,
          session,
        );

        const intraState = sellerStateCode === placeOfSupply;
        let subtotalPaise = 0;
        let discountTotalPaise = 0;
        let taxableTotalPaise = 0;
        let cgstTotalPaise = 0;
        let sgstTotalPaise = 0;
        let igstTotalPaise = 0;

        const invoiceItems: any[] = [];
        let totalCogsPaise = 0;

        for (const item of dto.items) {
          const product = productMap.get(item.productId);
          const quantity = item.quantity;

          const unitPricePaise = this.toPaise(product.sellingPrice);
          const grossPaise = unitPricePaise * quantity;
          const discountPaise = this.toPaise(item.discountAmount || 0);

          if (discountPaise > grossPaise) {
            throw new BadRequestException(
              `Discount exceeds the product amount for ${product.name}.`,
            );
          }

          const netPaise = grossPaise - discountPaise;
          const gstRate = product.gstRate;

          if (gstRate > 0 && !sellerGstin) {
            throw new BadRequestException(
              'A seller GSTIN must be configured before charging GST. Update the business profile first.',
            );
          }

          let taxablePaise: number;
          let taxPaise: number;

          if (product.priceIncludesTax) {
            taxablePaise = Math.round(
              (netPaise * 100) / (100 + gstRate),
            );
            taxPaise = netPaise - taxablePaise;
          } else {
            taxablePaise = netPaise;
            taxPaise = Math.round((taxablePaise * gstRate) / 100);
          }

          let cgstPaise = 0;
          let sgstPaise = 0;
          let igstPaise = 0;

          if (intraState) {
            cgstPaise = Math.round(taxPaise / 2);
            sgstPaise = taxPaise - cgstPaise;
          } else {
            igstPaise = taxPaise;
          }

          const lineTotalPaise = taxablePaise + taxPaise;

          subtotalPaise += grossPaise;
          discountTotalPaise += discountPaise;
          taxableTotalPaise += taxablePaise;
          cgstTotalPaise += cgstPaise;
          sgstTotalPaise += sgstPaise;
          igstTotalPaise += igstPaise;

          const warehouseStock = dto.warehouseId ? warehouseStockMap.get(String(product._id)) : null;
          const unitCostPaise = product.trackStock ? this.toPaise(dto.warehouseId ? (warehouseStock?.averageCost || 0) : (product.averageCost || 0)) : 0;
          if (product.trackStock && product.stockQty > 0 && !product.valuationInitialized) {
            throw new BadRequestException(`Inventory valuation is not initialized for ${product.name}. Reconcile opening stock before selling this item.`);
          }
          const lineCogsPaise = unitCostPaise * quantity;
          totalCogsPaise += lineCogsPaise;

          invoiceItems.push({
            productId: product._id,
            name: product.name,
            sku: product.sku || '',
            hsnCode: product.hsnCode || '',
            unit: product.unit,
            quantity,
            unitPrice: this.fromPaise(unitPricePaise),
            discountAmount: this.fromPaise(discountPaise),
            taxableValue: this.fromPaise(taxablePaise),
            gstRate,
            priceIncludesTax: product.priceIncludesTax,
            stockTracked: product.trackStock,
            unitCostAtSale: this.fromPaise(unitCostPaise),
            costOfGoodsSold: this.fromPaise(lineCogsPaise),
            cgstAmount: this.fromPaise(cgstPaise),
            sgstAmount: this.fromPaise(sgstPaise),
            igstAmount: this.fromPaise(igstPaise),
            totalTax: this.fromPaise(taxPaise),
            lineTotal: this.fromPaise(lineTotalPaise),
          });
        }

        const totalTaxPaise =
          cgstTotalPaise + sgstTotalPaise + igstTotalPaise;

        const grandTotalPaise =
          taxableTotalPaise + totalTaxPaise;

        const paymentInputs = dto.payments || [];
        const paymentTotalPaise = paymentInputs.reduce(
          (sum, payment) => sum + this.toPaise(payment.amount),
          0,
        );

        if (paymentTotalPaise > grandTotalPaise) {
          throw new BadRequestException(
            'Total payments cannot exceed the invoice grand total.',
          );
        }

        const duePaise = grandTotalPaise - paymentTotalPaise;

        const paymentStatus =
          paymentTotalPaise === 0
            ? 'UNPAID'
            : duePaise === 0
              ? 'PAID'
              : 'PARTIALLY_PAID';

        const payments = paymentInputs.map((payment) => ({
          method: payment.method,
          amount: this.fromPaise(this.toPaise(payment.amount)),
          reference: payment.reference || '',
          paidAt: now,
          receivedBy: new Types.ObjectId(userId),
        }));

        for (const [productId, quantity] of requestedQuantities) {
          const product = productMap.get(productId);

          if (!product.trackStock) {
            continue;
          }

          const previousQty = product.stockQty || 0;
          const warehouseStock = dto.warehouseId ? warehouseStockMap.get(String(product._id)) : null;
          if (dto.warehouseId && !warehouseStock) {
            throw new BadRequestException(`No stock is allocated for ${product.name} in the selected warehouse.`);
          }
          const availableQty = dto.warehouseId ? warehouseStock.quantity : previousQty;
          if (availableQty < quantity) {
            throw new BadRequestException(
              `Insufficient stock for ${product.name}. Available: ${availableQty}, requested: ${quantity}.`,
            );
          }
          const newQty = previousQty - quantity;
          const warehouseCostPaise = dto.warehouseId ? this.toPaise(warehouseStock.averageCost || 0) : this.toPaise(product.averageCost || 0);
          const relievedValuePaise = dto.warehouseId
            ? (quantity === warehouseStock.quantity ? this.toPaise(warehouseStock.inventoryValue || 0) : warehouseCostPaise * quantity)
            : this.toPaise(product.averageCost || 0) * quantity;
          if (dto.warehouseId) {
            const warehouseNewQty = warehouseStock.quantity - quantity;
            const warehouseNewValuePaise = Math.max(0, this.toPaise(warehouseStock.inventoryValue || 0) - relievedValuePaise);
            const warehouseUpdated = await this.warehouseStocks.findOneAndUpdate(
              tenantFilter(tenantId, { _id: warehouseStock._id, quantity: warehouseStock.quantity }),
              { $set: { quantity: warehouseNewQty, inventoryValue: this.fromPaise(warehouseNewValuePaise), averageCost: warehouseNewQty > 0 ? this.fromPaise(Math.round(warehouseNewValuePaise / warehouseNewQty)) : 0 } },
              { new: true, session, runValidators: true },
            );
            if (!warehouseUpdated) throw new ConflictException(`Warehouse stock changed while processing ${product.name}. Please retry.`);
          }

          const nextInventoryValuePaise = Math.max(0, this.toPaise(product.inventoryValue || 0) - relievedValuePaise);
          const updated = await this.products.findOneAndUpdate(
            tenantFilter(tenantId, {
              _id: product._id,
              isDeleted: false,
              trackStock: true,
              stockQty: previousQty,
            }),
            {
              $set: {
                stockQty: newQty,
                inventoryValue: this.fromPaise(nextInventoryValuePaise),
                averageCost: newQty > 0 ? this.fromPaise(Math.round(nextInventoryValuePaise / newQty)) : 0,
              },
            },
            {
              new: true,
              session,
              runValidators: true,
            },
          );

          if (!updated) {
            throw new ConflictException(
              `Stock changed while processing ${product.name}. Please retry the sale.`,
            );
          }

          await this.movements.create(
            [
              {
                tenantId: new Types.ObjectId(tenantId),
                productId: product._id,
                ...(dto.warehouseId ? { warehouseId: selectedWarehouse._id } : {}),
                type: 'SALE',
                quantityDelta: -quantity,
                previousQty,
                newQty,
                reason: `Sale invoice ${invoiceNumber}`,
                performedBy: new Types.ObjectId(userId),
              },
            ],
            { session },
          );
        }

        const grandTotal = this.fromPaise(grandTotalPaise);
        const paidAmount = this.fromPaise(paymentTotalPaise);

        const invoice = new this.invoices({
          tenantId: new Types.ObjectId(tenantId),
          idempotencyKey,
          requestFingerprint,
          costingVersion: 1,
          invoiceNumber,
          financialYear: fy,
          invoiceDate: now,
          sellerName: tenant.name,
          sellerGstin,
          sellerStateCode,
          sellerAddress: [
            tenant.addressLine1,
            tenant.addressLine2,
            tenant.city,
            tenant.district,
            tenant.pincode,
          ]
            .filter(Boolean)
            .join(', '),
          customerId: linkedCustomer?._id ?? null,
          warehouseId: selectedWarehouse?._id ?? null,
          customerName,
          customerPhone,
          customerGstin,
          placeOfSupplyStateCode: placeOfSupply,
          items: invoiceItems,
          subtotal: this.fromPaise(subtotalPaise),
          discountTotal: this.fromPaise(discountTotalPaise),
          taxableValue: this.fromPaise(taxableTotalPaise),
          cgstTotal: this.fromPaise(cgstTotalPaise),
          sgstTotal: this.fromPaise(sgstTotalPaise),
          igstTotal: this.fromPaise(igstTotalPaise),
          totalTax: this.fromPaise(totalTaxPaise),
          grandTotal,
          paidAmount,
          dueAmount: this.fromPaise(duePaise),
          paymentStatus,
          payments,
          status: 'ISSUED',
          createdBy: new Types.ObjectId(userId),
        });

        await invoice.save({ session });
        const saleLines: Array<{ accountCode: string; debit: number; credit: number; description: string }> = [];
        for (const payment of payments) {
          saleLines.push({
            accountCode: payment.method === 'CASH' ? '1000' : '1010',
            debit: payment.amount, credit: 0, description: `Invoice payment - ${payment.method}`,
          });
        }
        if (duePaise > 0) saleLines.push({
          accountCode: '1100', debit: this.fromPaise(duePaise), credit: 0,
          description: `Customer receivable - ${customerName || 'Walk-in'}`,
        });
        if (taxableTotalPaise > 0) saleLines.push({
          accountCode: '4000', debit: 0, credit: this.fromPaise(taxableTotalPaise),
          description: 'Sales revenue',
        });
        if (totalTaxPaise > 0) saleLines.push({
          accountCode: '2100', debit: 0, credit: this.fromPaise(totalTaxPaise),
          description: 'Output GST liability',
        });
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: now, narration: `Sales invoice ${invoiceNumber}`,
          sourceType: 'SALES', sourceId: invoice._id.toString(), lines: saleLines, session,
        });
        if (totalCogsPaise > 0) {
          await this.accounting.postOperationalJournal({
            tenantId, userId, postingDate: now,
            narration: `Cost of goods sold for ${invoiceNumber}`,
            sourceType: 'INVENTORY', sourceId: `SALE_COGS:${invoice._id.toString()}`,
            lines: [
              { accountCode: '5000', debit: this.fromPaise(totalCogsPaise), credit: 0, description: 'Cost of goods sold' },
              { accountCode: '1200', debit: 0, credit: this.fromPaise(totalCogsPaise), description: 'Inventory asset relieved' },
            ],
            session,
          });
        }
        result = invoice;
      });

      return result;
    } catch (error) {
      if ((error as any)?.code === 11000) {
        const duplicateInvoice = await this.invoices
          .findOne(tenantFilter(tenantId, { idempotencyKey }))
          .lean();

        if (duplicateInvoice) {
          if (duplicateInvoice.requestFingerprint !== requestFingerprint) {
            throw new ConflictException(
              'This idempotency key has already been used for a different sale.',
            );
          }

          return duplicateInvoice;
        }
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  async addPayment(
    tenantId: string,
    userId: string,
    invoiceId: string,
    dto: AddSalePaymentDto,
  ) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(invoiceId)
    ) {
      throw new BadRequestException(
        'Invalid tenant, user, or invoice ID.',
      );
    }

    const amountPaise = this.toPaise(dto.amount);

    if (amountPaise <= 0) {
      throw new BadRequestException(
        'Payment amount must be greater than zero.',
      );
    }

    const session = await this.connection.startSession();

    try {
      let result: any;

      await session.withTransaction(async () => {
        const invoice = await this.invoices
          .findOne(
            tenantFilter(tenantId, {
              _id: new Types.ObjectId(invoiceId),
              status: 'ISSUED',
            }),
          )
          .session(session);

        if (!invoice) {
          throw new NotFoundException(
            'Issued invoice not found. It may be cancelled or belong to another business.',
          );
        }

        const existingPayment = invoice.payments.find(
  (payment) => payment.idempotencyKey === dto.idempotencyKey,
);

if (existingPayment) {
  const samePayment =
    existingPayment.method === dto.method &&
    this.toPaise(existingPayment.amount) === amountPaise &&
    (existingPayment.reference || '') === (dto.reference || '');

  if (!samePayment) {
    throw new ConflictException(
      'This idempotency key has already been used for a different payment.',
    );
  }

  // Return the existing invoice without recording the payment again.
  result = invoice;
  return;
}

        const currentDuePaise = this.toPaise(invoice.dueAmount);

        if (currentDuePaise <= 0) {
          throw new ConflictException(
            'This invoice is already fully paid.',
          );
        }

        if (amountPaise > currentDuePaise) {
          throw new BadRequestException(
            `Payment exceeds the outstanding balance of ${this.fromPaise(currentDuePaise).toFixed(2)}.`,
          );
        }
        const newDuePaise = currentDuePaise - amountPaise;

        const paymentStatus =
          newDuePaise === 0 ? 'PAID' : 'PARTIALLY_PAID';

        const updated = await this.invoices.findOneAndUpdate(
          tenantFilter(tenantId, {
            _id: invoice._id,
            status: 'ISSUED',
            paidAmount: invoice.paidAmount,
            dueAmount: invoice.dueAmount,
          }),
          {
            $inc: {
              paidAmount: this.fromPaise(amountPaise),
              dueAmount: -this.fromPaise(amountPaise),
            },
            $set: {
              paymentStatus,
            },
            $push: {
              payments: {
  idempotencyKey: dto.idempotencyKey,
  method: dto.method,
  amount: this.fromPaise(amountPaise),
  reference: dto.reference || '',
  paidAt: new Date(),
  receivedBy: new Types.ObjectId(userId),
},
            },
          },
          {
            new: true,
            session,
          },
        );

        if (!updated) {
          throw new ConflictException(
            'Invoice balance changed while recording payment. Please refresh and retry.',
          );
        }

        const paymentAccount = dto.method === 'CASH' ? '1000' : '1010';
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: new Date(), narration: `Payment received for ${invoice.invoiceNumber}`,
          sourceType: 'PAYMENT', sourceId: `SALE_PAYMENT:${invoice._id.toString()}:${dto.idempotencyKey}`,
          lines: [
            { accountCode: paymentAccount, debit: this.fromPaise(amountPaise), credit: 0, description: `Received via ${dto.method}` },
            { accountCode: '1100', debit: 0, credit: this.fromPaise(amountPaise), description: 'Customer receivable settlement' },
          ], session,
        });
        result = updated;
      });

      return result;
    } finally {
      await session.endSession();
    }
  }
  async createCreditNote(
    tenantId: string,
    userId: string,
    invoiceId: string,
    dto: CreateCreditNoteDto,
  ) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(invoiceId)
    ) {
      throw new BadRequestException(
        'Invalid tenant, user, or invoice ID.',
      );
    }

    const reason = dto.reason?.trim();

    if (!reason || reason.length < 3 || reason.length > 250) {
      throw new BadRequestException(
        'Credit-note reason must contain 3 to 250 characters.',
      );
    }

    const lineIndexes = dto.items.map((item) => item.lineIndex);

    if (new Set(lineIndexes).size !== lineIndexes.length) {
      throw new BadRequestException(
        'A credit note cannot contain the same invoice line more than once.',
      );
    }

    const idempotencyKey = dto.idempotencyKey.trim().toLowerCase();

    const fingerprintPayload = {
      invoiceId,
      reason,
      items: dto.items
        .map((item) => ({
          lineIndex: item.lineIndex,
          quantity: item.quantity,
          restock: item.restock !== false,
        }))
        .sort((a, b) => a.lineIndex - b.lineIndex),
    };

    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify(fingerprintPayload))
      .digest('hex');

    const existingCreditNote = await this.creditNotes
      .findOne(tenantFilter(tenantId, { idempotencyKey }))
      .lean();

    if (existingCreditNote) {
      if (existingCreditNote.requestFingerprint !== requestFingerprint) {
        throw new ConflictException(
          'This idempotency key has already been used for a different credit note.',
        );
      }

      const existingInvoice = await this.invoices
        .findOne(tenantFilter(tenantId, { _id: existingCreditNote.invoiceId }))
        .lean();

      if (!existingInvoice) {
        throw new NotFoundException('Credit note invoice not found.');
      }

      return { creditNote: existingCreditNote, invoice: existingInvoice };
    }

    const creditNoteDate = new Date();
    const fy = this.financialYear(creditNoteDate);

    await this.ensureCreditNoteCounter(tenantId, fy);

    const session = await this.connection.startSession();

    try {
      let result: any;

      await session.withTransaction(async () => {
        const transactionDuplicate = await this.creditNotes
          .findOne(tenantFilter(tenantId, { idempotencyKey }))
          .session(session)
          .lean();

        if (transactionDuplicate) {
          if (transactionDuplicate.requestFingerprint !== requestFingerprint) {
            throw new ConflictException(
              'This idempotency key has already been used for a different credit note.',
            );
          }

          const duplicateInvoice = await this.invoices
            .findOne(
              tenantFilter(tenantId, { _id: transactionDuplicate.invoiceId }),
            )
            .session(session)
            .lean();

          if (!duplicateInvoice) {
            throw new NotFoundException('Credit note invoice not found.');
          }

          result = {
            creditNote: transactionDuplicate,
            invoice: duplicateInvoice,
          };
          return;
        }

        const invoice = await this.invoices
          .findOne(
            tenantFilter(tenantId, {
              _id: new Types.ObjectId(invoiceId),
              status: 'ISSUED',
            }),
          )
          .session(session);

        if (!invoice) {
          throw new NotFoundException(
            'Issued invoice not found. It may be cancelled or belong to another business.',
          );
        }

        await this.taxPeriods.assertOpen(tenantId, creditNoteDate, session);
        const previousNotes = await this.creditNotes
          .find(
            tenantFilter(tenantId, {
              invoiceId: invoice._id,
            }),
          )
          .session(session)
          .lean();

        const creditNumber = await this.nextCreditNoteNumber(
          tenantId,
          fy,
          session,
        );

        const creditLines: any[] = [];

        let discountTotalPaise = 0;
        let taxableTotalPaise = 0;
        let cgstTotalPaise = 0;
        let sgstTotalPaise = 0;
        let igstTotalPaise = 0;
        let taxTotalPaise = 0;
        let totalAmountPaise = 0;
        let restockedCostPaise = 0;

        for (const requested of dto.items) {
          const original = invoice.items[requested.lineIndex];

          if (!original) {
            throw new BadRequestException(
              `Invalid invoice line index: ${requested.lineIndex}.`,
            );
          }

          const previousReturnedQty = previousNotes.reduce(
            (sum, note) =>
              sum +
              note.items
                .filter(
                  (line: any) => line.lineIndex === requested.lineIndex,
                )
                .reduce(
                  (lineSum: number, line: any) =>
                    lineSum + line.quantity,
                  0,
                ),
            0,
          );

          const remainingQty =
            original.quantity - previousReturnedQty;

          if (requested.quantity > remainingQty) {
            throw new BadRequestException(
              `Return quantity exceeds the remaining quantity for "${original.name}". Remaining: ${remainingQty}.`,
            );
          }

          const previousLineReturns = previousNotes.flatMap((note) =>
            note.items.filter(
              (line: any) => line.lineIndex === requested.lineIndex,
            ),
          );

          const cumulativeQty =
            previousReturnedQty + requested.quantity;

          const allocateComponent = (
            originalAmount: number,
            component: string,
          ): number => {
            const originalPaise = this.toPaise(originalAmount);

            const alreadyCreditedPaise = previousLineReturns.reduce(
              (sum: number, line: any) =>
                sum + this.toPaise(Number(line[component] || 0)),
              0,
            );

            const cumulativeCreditedPaise = Math.round(
              (originalPaise * cumulativeQty) / original.quantity,
            );

            return cumulativeCreditedPaise - alreadyCreditedPaise;
          };

          const discountPaise = allocateComponent(
            original.discountAmount,
            'discountAmount',
          );
          const taxablePaise = allocateComponent(
            original.taxableValue,
            'taxableValue',
          );
          const cgstPaise = allocateComponent(
            original.cgstAmount,
            'cgstAmount',
          );
          const sgstPaise = allocateComponent(
            original.sgstAmount,
            'sgstAmount',
          );
          const igstPaise = allocateComponent(
            original.igstAmount,
            'igstAmount',
          );
          const taxPaise = allocateComponent(
            original.totalTax,
            'totalTax',
          );
          const lineTotalPaise = allocateComponent(
            original.lineTotal,
            'lineTotal',
          );

          if (
            [
              discountPaise,
              taxablePaise,
              cgstPaise,
              sgstPaise,
              igstPaise,
              taxPaise,
              lineTotalPaise,
            ].some((amount) => amount < 0)
          ) {
            throw new ConflictException(
              'Credit-note calculation produced an invalid negative amount.',
            );
          }

          const shouldRestock = requested.restock !== false;
          const restocked = shouldRestock && original.stockTracked;

          creditLines.push({
            lineIndex: requested.lineIndex,
            productId: original.productId,
            name: original.name,
            sku: original.sku || '',
            quantity: requested.quantity,
            unitPrice: original.unitPrice,
            discountAmount: this.fromPaise(discountPaise),
            taxableValue: this.fromPaise(taxablePaise),
            gstRate: original.gstRate,
            cgstAmount: this.fromPaise(cgstPaise),
            sgstAmount: this.fromPaise(sgstPaise),
            igstAmount: this.fromPaise(igstPaise),
            totalTax: this.fromPaise(taxPaise),
            lineTotal: this.fromPaise(lineTotalPaise),
            restocked,
          });

          discountTotalPaise += discountPaise;
          taxableTotalPaise += taxablePaise;
          cgstTotalPaise += cgstPaise;
          sgstTotalPaise += sgstPaise;
          igstTotalPaise += igstPaise;
          taxTotalPaise += taxPaise;
          totalAmountPaise += lineTotalPaise;

          if (restocked) {
            const product = await this.products
              .findOne(
                tenantFilter(tenantId, {
                  _id: original.productId,
                }),
              )
              .session(session);

            if (!product) {
              throw new ConflictException(
                `Cannot restore stock because product "${original.name}" no longer exists in this business.`,
              );
            }

            const previousQty = product.stockQty || 0;
            if (previousQty > 0 && !product.valuationInitialized) {
              throw new ConflictException(`Opening inventory valuation is required before restocking "${original.name}".`);
            }
            const newQty = previousQty + requested.quantity;
            const returnedUnitCostPaise = invoice.costingVersion === 1
              ? this.toPaise(original.unitCostAtSale || 0)
              : this.toPaise(product.averageCost || 0);
            const returnedCostPaise = returnedUnitCostPaise * requested.quantity;
            restockedCostPaise += returnedCostPaise;

            const updatedProduct = await this.products.findOneAndUpdate(
              tenantFilter(tenantId, {
                _id: product._id,
                stockQty: previousQty,
              }),
              { $set: {
                stockQty: newQty,
                inventoryValue: this.fromPaise(
                  this.toPaise(product.inventoryValue || 0) + returnedCostPaise,
                ),
                averageCost: newQty > 0
                  ? this.fromPaise(Math.round((this.toPaise(product.inventoryValue || 0) + returnedCostPaise) / newQty))
                  : product.averageCost,
                valuationInitialized: product.valuationInitialized || returnedCostPaise > 0,
              } },
              { new: true, session, runValidators: true },
            );

            if (!updatedProduct) {
              throw new ConflictException(
                `Stock changed while returning "${original.name}". Please retry.`,
              );
            }

            await this.movements.create(
              [
                {
                  tenantId: new Types.ObjectId(tenantId),
                  productId: product._id,
                  type: 'SALE_RETURN',
                  quantityDelta: requested.quantity,
                  previousQty,
                  newQty,
                  reason: `Credit note ${creditNumber}: ${reason}`.slice(
                    0,
                    250,
                  ),
                  performedBy: new Types.ObjectId(userId),
                },
              ],
              { session },
            );
          }
        }

        const creditTotalPaise = totalAmountPaise;
        const currentDuePaise = this.toPaise(invoice.dueAmount);
        const appliedToDuePaise = Math.min(
          creditTotalPaise,
          currentDuePaise,
        );
        const refundablePaise =
          creditTotalPaise - appliedToDuePaise;

        const newCreditedPaise =
          this.toPaise(Number(invoice.creditedAmount || 0)) +
          creditTotalPaise;

        const newDuePaise = currentDuePaise - appliedToDuePaise;
        const paidPaise = this.toPaise(invoice.paidAmount);

        const paymentStatus =
          newDuePaise === 0
            ? paidPaise === 0
              ? 'CREDITED'
              : 'PAID'
            : paidPaise > 0
              ? 'PARTIALLY_PAID'
              : 'UNPAID';

        const updatedInvoice = await this.invoices.findOneAndUpdate(
          tenantFilter(tenantId, {
            _id: invoice._id,
            status: 'ISSUED',
            dueAmount: invoice.dueAmount,
            creditedAmount: invoice.creditedAmount || 0,
          }),
          {
            $set: {
              creditedAmount: this.fromPaise(newCreditedPaise),
              dueAmount: this.fromPaise(newDuePaise),
              paymentStatus,
            },
          },
          { new: true, session },
        );

        if (!updatedInvoice) {
          throw new ConflictException(
            'Invoice balance changed while creating the credit note. Please retry.',
          );
        }

        const [created] = await this.creditNotes.create(
          [
            {
              tenantId: new Types.ObjectId(tenantId),
              invoiceId: invoice._id,
              idempotencyKey,
              requestFingerprint,
              creditNoteNumber: creditNumber,
              financialYear: fy,
              creditNoteDate,
              originalInvoiceNumber: invoice.invoiceNumber,
              items: creditLines,
              discountTotal: this.fromPaise(discountTotalPaise),
              taxableValue: this.fromPaise(taxableTotalPaise),
              cgstTotal: this.fromPaise(cgstTotalPaise),
              sgstTotal: this.fromPaise(sgstTotalPaise),
              igstTotal: this.fromPaise(igstTotalPaise),
              totalTax: this.fromPaise(taxTotalPaise),
              totalAmount: this.fromPaise(creditTotalPaise),
              appliedToDueAmount: this.fromPaise(appliedToDuePaise),
              refundableAmount: this.fromPaise(refundablePaise),
              refundedAmount: 0,
              refunds: [],
              reason,
              createdBy: new Types.ObjectId(userId),
            },
          ],
          { session },
        );

        const creditJournalLines: Array<{ accountCode: string; debit: number; credit: number; description: string }> = [];
        if (taxableTotalPaise > 0) creditJournalLines.push({
          accountCode: '4000', debit: this.fromPaise(taxableTotalPaise), credit: 0,
          description: 'Sales revenue reversal',
        });
        if (taxTotalPaise > 0) creditJournalLines.push({
          accountCode: '2100', debit: this.fromPaise(taxTotalPaise), credit: 0,
          description: 'Output GST liability reversal',
        });
        if (appliedToDuePaise > 0) creditJournalLines.push({
          accountCode: '1100', debit: 0, credit: this.fromPaise(appliedToDuePaise),
          description: 'Credit applied to customer receivable',
        });
        if (refundablePaise > 0) creditJournalLines.push({
          accountCode: '2200', debit: 0, credit: this.fromPaise(refundablePaise),
          description: 'Customer refund payable',
        });
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: creditNoteDate,
          narration: `Credit note ${creditNumber} against ${invoice.invoiceNumber}: ${reason}`,
          sourceType: 'REFUND', sourceId: `CREDIT_NOTE:${created._id.toString()}`,
          lines: creditJournalLines, session,
        });
        if (restockedCostPaise > 0) {
          await this.accounting.postOperationalJournal({
            tenantId, userId, postingDate: creditNoteDate,
            narration: `Inventory restored by credit note ${creditNumber}`,
            sourceType: 'INVENTORY', sourceId: `CREDIT_NOTE_COGS:${created._id.toString()}`,
            lines: [
              { accountCode: '1200', debit: this.fromPaise(restockedCostPaise), credit: 0, description: 'Returned inventory at original cost' },
              { accountCode: '5000', debit: 0, credit: this.fromPaise(restockedCostPaise), description: 'Reverse cost of goods sold' },
            ],
            session,
          });
        }
        result = {
          creditNote: created,
          invoice: updatedInvoice,
        };
      });

      return result;
    } catch (error) {
      if ((error as any)?.code === 11000) {
        const duplicate = await this.creditNotes
          .findOne(tenantFilter(tenantId, { idempotencyKey }))
          .lean();

        if (duplicate) {
          if (duplicate.requestFingerprint !== requestFingerprint) {
            throw new ConflictException(
              'This idempotency key has already been used for a different credit note.',
            );
          }

          const duplicateInvoice = await this.invoices
            .findOne(tenantFilter(tenantId, { _id: duplicate.invoiceId }))
            .lean();

          if (!duplicateInvoice) {
            throw new NotFoundException('Credit note invoice not found.');
          }

          return { creditNote: duplicate, invoice: duplicateInvoice };
        }
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  async findCreditNotes(tenantId: string, invoiceId: string) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(invoiceId)
    ) {
      throw new BadRequestException(
        'Invalid tenant or invoice ID.',
      );
    }

    const invoice = await this.invoices.findOne(
      tenantFilter(tenantId, {
        _id: new Types.ObjectId(invoiceId),
      }),
    );

    if (!invoice) {
      throw new NotFoundException('Invoice not found.');
    }

    return this.creditNotes
      .find(
        tenantFilter(tenantId, {
          invoiceId: invoice._id,
        }),
      )
      .sort({ creditNoteDate: -1, createdAt: -1 })
      .lean();
  }
  async addCreditNoteRefund(
    tenantId: string,
    userId: string,
    invoiceId: string,
    creditNoteId: string,
    dto: AddCreditNoteRefundDto,
  ) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(invoiceId) ||
      !Types.ObjectId.isValid(creditNoteId)
    ) {
      throw new BadRequestException(
        'Invalid tenant, user, invoice, or credit note ID.',
      );
    }

    const amountPaise = this.toPaise(Number(dto.amount));
    const reference = dto.reference?.trim() || '';

    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new BadRequestException('Refund amount must be positive.');
    }

    let result: any;
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        const filter = tenantFilter(tenantId, {
          _id: new Types.ObjectId(creditNoteId),
          invoiceId: new Types.ObjectId(invoiceId),
        });

        const creditNote = await this.creditNotes
          .findOne(filter)
          .session(session)
          .lean();

        if (!creditNote) {
          throw new NotFoundException('Credit note not found.');
        }

        const refunds = creditNote.refunds || [];

        const existingRefund = refunds.find(
          (refund: any) =>
            refund.idempotencyKey === dto.idempotencyKey,
        );

        if (existingRefund) {
          const sameRequest =
            this.toPaise(Number(existingRefund.amount)) === amountPaise &&
            existingRefund.method === dto.method &&
            (existingRefund.reference || '') === reference;

          if (!sameRequest) {
            throw new ConflictException(
              'This idempotency key was already used with different refund details.',
            );
          }

          result = {
            creditNote,
            refund: existingRefund,
            duplicate: true,
          };
          return;
        }

        const refundablePaise = this.toPaise(
          Number(creditNote.refundableAmount || 0),
        );

        const alreadyRefundedPaise = this.toPaise(
          Number(creditNote.refundedAmount || 0),
        );

        const remainingPaise =
          refundablePaise - alreadyRefundedPaise;

        if (amountPaise > remainingPaise) {
          throw new BadRequestException(
            `Refund exceeds the remaining refundable amount of ${this.fromPaise(Math.max(0, remainingPaise)).toFixed(2)}.`,
          );
        }

        const updatedCreditNote = await this.creditNotes
          .findOneAndUpdate(
            {
              ...filter,
              refundedAmount: creditNote.refundedAmount || 0,
            },
            {
              $set: {
                refundedAmount: this.fromPaise(
                  alreadyRefundedPaise + amountPaise,
                ),
              },
              $push: {
                refunds: {
                  idempotencyKey: dto.idempotencyKey,
                  method: dto.method,
                  amount: this.fromPaise(amountPaise),
                  reference,
                  refundedAt: new Date(),
                  refundedBy: new Types.ObjectId(userId),
                },
              },
            },
            {
              new: true,
              session,
              runValidators: true,
            },
          )
          .lean();

        if (!updatedCreditNote) {
          throw new ConflictException(
            'Credit note changed during refund. Please retry.',
          );
        }

        const savedRefund = (updatedCreditNote.refunds || []).find(
          (refund: any) =>
            refund.idempotencyKey === dto.idempotencyKey,
        );

        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: new Date(),
          narration: `Refund paid for credit note ${creditNote.creditNoteNumber}`,
          sourceType: 'PAYMENT',
          sourceId: `CREDIT_NOTE_REFUND:${creditNote._id.toString()}:${dto.idempotencyKey}`,
          lines: [
            { accountCode: '2200', debit: this.fromPaise(amountPaise), credit: 0, description: 'Settle customer refund payable' },
            { accountCode: dto.method === 'CASH' ? '1000' : '1010', debit: 0, credit: this.fromPaise(amountPaise), description: `Refund via ${dto.method}` },
          ], session,
        });
        result = {
          creditNote: updatedCreditNote,
          refund: savedRefund,
          duplicate: false,
        };
      });
    } finally {
      await session.endSession();
    }

    return result;
  }
  async findAll(tenantId: string, dto: ListSalesDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const filter: any = {};

    if (dto.status) {
      filter.status = dto.status;
    }

    if (dto.search) {
      const escaped = dto.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(escaped, 'i');

      filter.$or = [
        { invoiceNumber: expression },
        { customerName: expression },
        { customerPhone: expression },
      ];
    }

    const scopedFilter = tenantFilter(tenantId, filter);

    const [items, total] = await Promise.all([
      this.invoices
        .find(scopedFilter)
        .sort({ invoiceDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      this.invoices.countDocuments(scopedFilter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid invoice ID.');
    }

    const invoice = await this.invoices
      .findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id) }))
      .lean();

    if (!invoice) {
      throw new NotFoundException('Invoice not found.');
    }

    return invoice;
  }

  async cancelSale(
    tenantId: string,
    userId: string,
    id: string,
    reason: string,
  ) {
    if (
      !Types.ObjectId.isValid(id) ||
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new BadRequestException('Invalid invoice, tenant, or user ID.');
    }

    const saleDate = new Date();
    const fy = this.financialYear(saleDate);

    await this.ensureInvoiceCounter(tenantId, fy);

    const session = await this.connection.startSession();

    try {
      let result: any;

      await session.withTransaction(async () => {
        const invoice = await this.invoices
          .findOne(
            tenantFilter(tenantId, {
              _id: new Types.ObjectId(id),
              status: 'ISSUED',
            }),
          )
          .session(session);

        if (!invoice) {
          throw new NotFoundException(
            'Issued invoice not found. It may already be cancelled.',
          );
        }

        await this.taxPeriods.assertOpen(tenantId, invoice.invoiceDate, session);

        if (
  invoice.paidAmount > 0 ||
  Number(invoice.creditedAmount || 0) > 0
) {
  throw new ConflictException(
    'This invoice has payments or issued credit notes and cannot be cancelled.',
  );
}

        const restoreQuantities = new Map<string, number>();
        const restoreValuesPaise = new Map<string, number>();

        for (const item of invoice.items) {
          if (!item.stockTracked) continue;
          const productId = item.productId.toString();
          restoreQuantities.set(productId, (restoreQuantities.get(productId) || 0) + item.quantity);
          if (invoice.costingVersion === 1) {
            restoreValuesPaise.set(
              productId,
              (restoreValuesPaise.get(productId) || 0) + this.toPaise(item.costOfGoodsSold || 0),
            );
          }
        }

        for (const [productId, quantity] of restoreQuantities) {
          const product = await this.products
            .findOne(
              tenantFilter(tenantId, {
                _id: new Types.ObjectId(productId),
              }),
            )
            .session(session);

          if (!product) {
            throw new ConflictException(
              `Cannot restore stock because product ${productId} no longer exists.`,
            );
          }

          const previousQty = product.stockQty || 0;
          if (previousQty > 0 && !product.valuationInitialized) {
            throw new ConflictException('Opening inventory valuation is required before restoring stock for this invoice.');
          }
          const newQty = previousQty + quantity;
          const restoredValuePaise = invoice.costingVersion === 1
            ? (restoreValuesPaise.get(productId) || 0)
            : this.toPaise(product.averageCost || 0) * quantity;

          const updated = await this.products.findOneAndUpdate(
            tenantFilter(tenantId, {
              _id: product._id,
              stockQty: previousQty,
            }),
            {
              $set: {
                stockQty: previousQty + quantity,
                inventoryValue: this.fromPaise(
                  this.toPaise(product.inventoryValue || 0) + restoredValuePaise,
                ),
                averageCost: newQty > 0
                  ? this.fromPaise(Math.round((
                      this.toPaise(product.inventoryValue || 0) + restoredValuePaise
                    ) / newQty))
                  : product.averageCost,
                valuationInitialized: product.valuationInitialized || restoredValuePaise > 0,
              },
            },
            {
              new: true,
              session,
              runValidators: true,
            },
          );

          if (!updated) {
            throw new ConflictException(
              `Stock changed while cancelling invoice ${invoice.invoiceNumber}. Please retry.`,
            );
          }

          await this.movements.create(
            [
              {
                tenantId: new Types.ObjectId(tenantId),
                productId: product._id,
                type: 'SALE_RETURN',
                quantityDelta: quantity,
                previousQty,
                newQty,
                reason: `Cancellation ${invoice.invoiceNumber}: ${reason}`.slice(
                  0,
                  250,
                ),
                performedBy: new Types.ObjectId(userId),
              },
            ],
            { session },
          );
        }

        const cancelled = await this.invoices.findOneAndUpdate(
          tenantFilter(tenantId, {
            _id: invoice._id,
            status: 'ISSUED',
          }),
          {
            $set: {
              status: 'CANCELLED',
              cancelledBy: new Types.ObjectId(userId),
              cancelledAt: new Date(),
              cancellationReason: reason,
            },
          },
          {
            new: true,
            session,
          },
        );

        if (!cancelled) {
          throw new ConflictException(
            'Invoice status changed while cancelling. Please retry.',
          );
        }

        await this.accounting.reverseOperationalJournal({
          tenantId, userId, sourceType: 'SALES', sourceId: invoice._id.toString(),
          reason: reason || 'Sales invoice cancelled', session,
        });
        await this.accounting.reverseOperationalJournal({
          tenantId, userId, sourceType: 'INVENTORY',
          sourceId: `SALE_COGS:${invoice._id.toString()}`,
          reason: reason || 'Sales invoice cancelled', session,
        });
        result = cancelled;
      });

      return result;
    } finally {
      await session.endSession();
    }
  }
}














