import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import { tenantFilter } from '../common/tenant-scoped.service';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { Supplier, SupplierDocument } from '../suppliers/schemas/supplier.schema';
import {
  InventoryMovement, InventoryMovementDocument,
} from '../inventory/schemas/inventory-movement.schema';
import { Purchase, PurchaseDocument } from './schemas/purchase.schema';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { ReceivePurchaseDto } from './dto/receive-purchase.dto';
import { ListPurchasesDto } from './dto/list-purchases.dto';
import { AddPurchasePaymentDto } from './dto/add-purchase-payment.dto';
import { AccountingService } from '../accounting/accounting.service';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name) private readonly purchases: Model<PurchaseDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Supplier.name) private readonly suppliers: Model<SupplierDocument>,
    @InjectModel(InventoryMovement.name) private readonly movements: Model<InventoryMovementDocument>,
    private readonly accounting: AccountingService,
  ) {}


  private toPaise(value: number): number { return Math.round((value + Number.EPSILON) * 100); }
  private fromPaise(value: number): number { return value / 100; }

  async addPayment(tenantId: string, userId: string, id: string, dto: AddPurchasePaymentDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid tenant, user or purchase ID');
    const amountPaise = this.toPaise(dto.amount);
    const session = await this.purchases.db.startSession();
    let result: PurchaseDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const purchase = await this.purchases.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id) })).session(session);
        if (!purchase) throw new NotFoundException('Purchase not found');
        const existing = (purchase.payments || []).find((payment: any) => payment.idempotencyKey === dto.idempotencyKey);
        if (existing) {
          if (existing.method !== dto.method || this.toPaise(existing.amount) !== amountPaise || (existing.reference || '') !== (dto.reference || '')) throw new ConflictException('This idempotency key was already used for a different payment');
          result = purchase;
          return;
        }
        if (purchase.status === 'CANCELLED') throw new ConflictException('Cancelled purchases cannot accept payments');
        const paidPaise = this.toPaise(purchase.paidAmount || 0);
        const totalPaise = this.toPaise(purchase.grandTotal);
        const duePaise = Math.max(0, totalPaise - paidPaise);
        if (duePaise <= 0) throw new ConflictException('This purchase is already fully paid');
        if (amountPaise <= 0) throw new BadRequestException('Payment must be greater than zero');
        if (amountPaise > duePaise) throw new BadRequestException('Payment exceeds the outstanding purchase balance');
        purchase.payments = purchase.payments || [];
        purchase.payments.push({ idempotencyKey: dto.idempotencyKey, method: dto.method, amount: this.fromPaise(amountPaise), reference: dto.reference || '', paidAt: new Date(), receivedBy: new Types.ObjectId(userId) } as any);
        purchase.paidAmount = this.fromPaise(paidPaise + amountPaise);
        purchase.dueAmount = this.fromPaise(totalPaise - paidPaise - amountPaise);
        await purchase.save({ session });
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: new Date(), narration: `Supplier payment for ${purchase.purchaseNumber}`,
          sourceType: 'PAYMENT',
          sourceId: `PURCHASE_PAYMENT:${purchase._id.toString()}:${dto.idempotencyKey}`,
          lines: [
            { accountCode: '2000', debit: this.fromPaise(amountPaise), credit: 0, description: 'Accounts payable settlement' },
            { accountCode: dto.method === 'CASH' ? '1000' : '1010', debit: 0, credit: this.fromPaise(amountPaise), description: `Paid via ${dto.method}` },
          ], session,
        });
        result = purchase;
      });
    } finally { await session.endSession(); }
    if (!result) throw new Error('Purchase payment could not be recorded');
    return result;
  }

  async supplierLedger(tenantId: string, supplierId: string, query: ListPurchasesDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(supplierId)) throw new BadRequestException('Invalid tenant or supplier ID');
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = tenantFilter(tenantId, { supplierId: new Types.ObjectId(supplierId) });
    const [items, total] = await Promise.all([
      this.purchases.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .select('purchaseNumber supplierInvoiceNumber purchaseDate grandTotal paidAmount dueAmount payments status createdAt').lean(),
      this.purchases.countDocuments(filter),
    ]);
    const totals = await this.purchases.aggregate([
      { $match: { tenantId: new Types.ObjectId(tenantId), supplierId: new Types.ObjectId(supplierId), status: { $ne: 'CANCELLED' } } },
      { $group: { _id: null, purchases: { $sum: '$grandTotal' }, paid: { $sum: { $ifNull: ['$paidAmount', 0] } }, outstanding: { $sum: { $subtract: ['$grandTotal', { $ifNull: ['$paidAmount', 0] }] } } } },
    ]);
    return { summary: { purchaseTotal: totals[0]?.purchases || 0, paidTotal: totals[0]?.paid || 0, outstanding: totals[0]?.outstanding || 0 }, items, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async create(tenantId: string, userId: string, dto: CreatePurchaseDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid tenant or authenticated user');
    }
    if (!Types.ObjectId.isValid(dto.supplierId)) {
      throw new BadRequestException('Invalid supplier ID');
    }

    const productIds = dto.items.map((item) => item.productId.toLowerCase());
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException('Each product must appear only once in a purchase');
    }
    const session = await this.purchases.db.startSession();
    let result: PurchaseDocument | null = null;

    try {
      await session.withTransaction(async () => {
        const supplier = await this.suppliers.findOne(
          tenantFilter(tenantId, { _id: new Types.ObjectId(dto.supplierId), isDeleted: false }),
        ).session(session);

        if (!supplier) throw new NotFoundException('Supplier not found');

        const items = [];
        let subtotal = 0;
        let gstTotal = 0;

        for (const input of dto.items) {
          if (!Types.ObjectId.isValid(input.productId)) {
            throw new BadRequestException('Invalid product ID');
          }

          const product = await this.products.findOne(
            tenantFilter(tenantId, {
              _id: new Types.ObjectId(input.productId),
              isDeleted: false,
            }),
          ).session(session);

          if (!product) throw new NotFoundException(`Product not found: ${input.productId}`);

          const taxableValue = Number((input.unitCost * input.quantity).toFixed(2));
          const gstAmount = Number((taxableValue * input.gstRate / 100).toFixed(2));
          const lineTotal = Number((taxableValue + gstAmount).toFixed(2));

          subtotal += taxableValue;
          gstTotal += gstAmount;

          items.push({
            productId: product._id,
            name: product.name,
            sku: product.sku ?? '',
            hsnCode: product.hsnCode ?? '',
            unit: product.unit,
            quantity: input.quantity,
            receivedQty: 0,
            unitCost: input.unitCost,
            gstRate: input.gstRate,
            taxableValue,
            gstAmount,
            lineTotal,
            trackStock: product.trackStock,
          });
        }

        const purchaseNumber = `PUR-${new Types.ObjectId().toHexString().slice(-8).toUpperCase()}`;
        const [purchase] = await this.purchases.create([{
          tenantId: new Types.ObjectId(tenantId),
          purchaseNumber,
          supplierId: supplier._id,
          supplierInvoiceNumber: dto.supplierInvoiceNumber.trim(),
          items,
          subtotal: Number(subtotal.toFixed(2)),
          gstTotal: Number(gstTotal.toFixed(2)),
          grandTotal: Number((subtotal + gstTotal).toFixed(2)),
          paidAmount: 0,
          dueAmount: Number((subtotal + gstTotal).toFixed(2)),
          payments: [],
          status: 'DRAFT',
          notes: dto.notes?.trim() ?? '',
          receipts: [],
          createdBy: new Types.ObjectId(userId),
        }], { session });

        const purchaseJournalLines: Array<{ accountCode: string; debit: number; credit: number; description: string }> = [];
        const trackedCostPaise = items.reduce((sum: number, item: any) =>
          sum + (item.trackStock ? this.toPaise(item.taxableValue) : 0), 0);
        const nonTrackedCostPaise = items.reduce((sum: number, item: any) =>
          sum + (!item.trackStock ? this.toPaise(item.taxableValue) : 0), 0);
        if (trackedCostPaise > 0) purchaseJournalLines.push({
          accountCode: '1210', debit: this.fromPaise(trackedCostPaise), credit: 0,
          description: 'Inventory in transit',
        });
        if (nonTrackedCostPaise > 0) purchaseJournalLines.push({
          accountCode: '5100', debit: this.fromPaise(nonTrackedCostPaise), credit: 0,
          description: 'Non-stock purchase expense',
        });
        if (gstTotal > 0) purchaseJournalLines.push({
          accountCode: '1300', debit: Number(gstTotal.toFixed(2)), credit: 0,
          description: 'Input GST credit',
        });
        if (purchase.grandTotal > 0) purchaseJournalLines.push({
          accountCode: '2000', debit: 0, credit: purchase.grandTotal,
          description: 'Supplier accounts payable',
        });
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: purchase.purchaseDate,
          narration: `Supplier invoice ${purchase.supplierInvoiceNumber} - ${purchase.purchaseNumber}`,
          sourceType: 'PURCHASE', sourceId: purchase._id.toString(),
          lines: purchaseJournalLines, session,
        });
        result = purchase;
      });
    } finally {
      await session.endSession();
    }

    if (!result) throw new Error('Purchase could not be created');
    return result;
  }

  async receive(tenantId: string, userId: string, id: string, dto: ReceivePurchaseDto) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(id) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new BadRequestException('Invalid tenant, purchase or user ID');
    }

    const normalizedMap = new Map<string, number>();
    for (const item of dto.items) {
      if (!Types.ObjectId.isValid(item.productId)) {
        throw new BadRequestException('Invalid product ID');
      }
      const productId = item.productId.toLowerCase();
      normalizedMap.set(
        productId,
        (normalizedMap.get(productId) ?? 0) + item.quantity,
      );
    }

    const normalizedItems = Array.from(normalizedMap, ([productId, quantity]) => ({
      productId,
      quantity,
    })).sort((a, b) => a.productId.localeCompare(b.productId));

    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify(normalizedItems))
      .digest('hex');
    const session = await this.purchases.db.startSession();
    let result: PurchaseDocument | null = null;

    try {
      await session.withTransaction(async () => {
        const purchase = await this.purchases.findOne(
          tenantFilter(tenantId, { _id: new Types.ObjectId(id) }),
        ).session(session);

        if (!purchase) throw new NotFoundException('Purchase not found');

        const previousReceipt = purchase.receipts.find(
          (receipt) => receipt.idempotencyKey === dto.idempotencyKey,
        );
        if (previousReceipt) {
          if (previousReceipt.requestFingerprint !== requestFingerprint) {
            throw new ConflictException('Idempotency key was already used with a different receipt request');
          }
          result = purchase;
          return;
        }

        if (purchase.status === 'CANCELLED' || purchase.status === 'RECEIVED') {
          throw new ConflictException('This purchase cannot receive more stock');
        }

        let inventoryTransferPaise = 0;
        const receivedByProduct = new Map<string, number>();
        for (const item of dto.items) {
          if (!Types.ObjectId.isValid(item.productId)) {
            throw new BadRequestException('Invalid product ID');
          }
          const key = item.productId;
          receivedByProduct.set(key, (receivedByProduct.get(key) ?? 0) + item.quantity);
        }

        for (const [productId, quantity] of receivedByProduct) {
          const line = purchase.items.find((item) => item.productId.toString() === productId);
          if (!line) throw new BadRequestException(`Product ${productId} is not part of this purchase`);
          if (line.receivedQty + quantity > line.quantity) {
            throw new BadRequestException(`Received quantity exceeds ordered quantity for ${line.name}`);
          }
        }

        for (const [productId, quantity] of receivedByProduct) {
          const line = purchase.items.find((item) => item.productId.toString() === productId)!;
          const product = await this.products.findOne(
            tenantFilter(tenantId, {
              _id: line.productId,
              isDeleted: false,
            }),
          ).session(session);

          if (!product) throw new NotFoundException(`Product not found: ${line.name}`);

          if (product.trackStock) {
            const previousQty = product.stockQty;
            const newQty = previousQty + quantity;

            const updated = await this.products.findOneAndUpdate(
              tenantFilter(tenantId, {
                _id: product._id,
                isDeleted: false,
                trackStock: true,
                stockQty: previousQty,
              }),
              { $set: { stockQty: newQty } },
              { new: true, session, runValidators: true },
            );

            if (!updated) throw new ConflictException(`Stock changed while receiving ${line.name}`);

            await this.movements.create([{
              tenantId: new Types.ObjectId(tenantId),
              productId: product._id,
              type: 'IN',
              quantityDelta: quantity,
              previousQty,
              newQty,
              reason: `Purchase ${purchase.purchaseNumber}`,
              performedBy: new Types.ObjectId(userId),
            }], { session });
          }

          if (line.trackStock) {
            const oldAllocated = Math.round(this.toPaise(line.taxableValue) * line.receivedQty / line.quantity);
            const newAllocated = Math.round(this.toPaise(line.taxableValue) * (line.receivedQty + quantity) / line.quantity);
            inventoryTransferPaise += newAllocated - oldAllocated;
          }
          line.receivedQty += quantity;
        }

        purchase.receipts.push({
          idempotencyKey: dto.idempotencyKey,
          requestFingerprint,
          items: Array.from(receivedByProduct, ([productId, quantity]) => ({
            productId: new Types.ObjectId(productId),
            quantity,
          })),
          receivedBy: new Types.ObjectId(userId),
          receivedAt: new Date(),
        } as any);

        const allReceived = purchase.items.every((item) => item.receivedQty === item.quantity);
        const anyReceived = purchase.items.some((item) => item.receivedQty > 0);
        purchase.status = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'DRAFT';

        await purchase.save({ session });
        if (inventoryTransferPaise > 0) {
          const transferAmount = this.fromPaise(inventoryTransferPaise);
          await this.accounting.postOperationalJournal({
            tenantId, userId, postingDate: new Date(),
            narration: `Inventory received against ${purchase.purchaseNumber}`,
            sourceType: 'PURCHASE', sourceId: `PURCHASE_RECEIPT:${purchase._id.toString()}:${dto.idempotencyKey}`,
            lines: [
              { accountCode: '1200', debit: transferAmount, credit: 0, description: 'Received inventory' },
              { accountCode: '1210', debit: 0, credit: transferAmount, description: 'Release inventory in transit' },
            ], session,
          });
        }
        result = purchase;
      });
    } finally {
      await session.endSession();
    }

    if (!result) throw new Error('Purchase receiving failed');
    return result;
  }

  async findAll(tenantId: string, query: ListPurchasesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = tenantFilter(tenantId, {});

    const [items, total] = await Promise.all([
      this.purchases.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('supplierId', 'name phone email gstin')
        .lean(),
      this.purchases.countDocuments(filter),
    ]);

    return {
      items,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid purchase ID');
    const purchase = await this.purchases.findOne(
      tenantFilter(tenantId, { _id: new Types.ObjectId(id) }),
    ).populate('supplierId', 'name phone email gstin').lean();

    if (!purchase) throw new NotFoundException('Purchase not found');
    return purchase;
  }

  async cancel(tenantId: string, userId: string, id: string) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(id) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new BadRequestException('Invalid tenant, purchase or user ID');
    }

    const session = await this.purchases.db.startSession();
    let purchase: PurchaseDocument | null = null;
    try {
      await session.withTransaction(async () => {
        purchase = await this.purchases.findOneAndUpdate(
          tenantFilter(tenantId, {
            _id: new Types.ObjectId(id),
            status: 'DRAFT',
            $or: [{ paidAmount: 0 }, { paidAmount: { $exists: false } }],
          }),
          {
            $set: {
              status: 'CANCELLED',
              cancelledBy: new Types.ObjectId(userId),
              cancelledAt: new Date(),
            },
          },
          { new: true, runValidators: true, session },
        );
        if (purchase) {
          await this.accounting.reverseOperationalJournal({
            tenantId, userId, sourceType: 'PURCHASE', sourceId: purchase._id.toString(),
            reason: 'Purchase cancelled before stock receipt', session,
          });
        }
      });
    } finally {
      await session.endSession();
    }
    if (purchase) return purchase;

    const existing = await this.purchases.exists(
      tenantFilter(tenantId, { _id: new Types.ObjectId(id) }),
    );
    if (!existing) throw new NotFoundException('Purchase not found');
    throw new ConflictException(
      'Only purchases with no received stock can be cancelled',
    );
  }
}
