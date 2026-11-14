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
import { Warehouse } from '../branches/schemas/warehouse.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { WarehouseStock, WarehouseStockDocument } from '../inventory/schemas/warehouse-stock.schema';
import { Purchase, PurchaseDocument } from './schemas/purchase.schema';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { ReceivePurchaseDto } from './dto/receive-purchase.dto';
import { ListPurchasesDto } from './dto/list-purchases.dto';
import { AddPurchasePaymentDto } from './dto/add-purchase-payment.dto';
import { ReviewPurchaseItcDto } from './dto/review-purchase-itc.dto';
import { AccountingService } from '../accounting/accounting.service';
import { TaxPeriodsService } from '../accounting/tax-periods.service';
import { Tenant, TenantDocument } from '../tenants/schemas/tenant.schema';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name) private readonly purchases: Model<PurchaseDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Supplier.name) private readonly suppliers: Model<SupplierDocument>,
    @InjectModel(Tenant.name) private readonly tenants: Model<TenantDocument>,
    @InjectModel(InventoryMovement.name) private readonly movements: Model<InventoryMovementDocument>,
    private readonly accounting: AccountingService,
    private readonly taxPeriods: TaxPeriodsService,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<Warehouse>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    @InjectModel(WarehouseStock.name) private readonly warehouseStocks: Model<WarehouseStockDocument>,
  ) {}


  private toPaise(value: number): number { return Math.round((value + Number.EPSILON) * 100); }
  private fromPaise(value: number): number { return value / 100; }

  private splitGst(gstAmount: number, supplierStateCode?: string | null, placeOfSupplyStateCode?: string | null) {
    const gstPaise = this.toPaise(gstAmount);
    if (gstPaise === 0) return { cgstAmount: 0, sgstAmount: 0, igstAmount: 0, classified: true };
    if (!supplierStateCode || !placeOfSupplyStateCode) {
      return { cgstAmount: 0, sgstAmount: 0, igstAmount: 0, classified: false };
    }
    if (supplierStateCode === placeOfSupplyStateCode) {
      const cgstPaise = Math.floor(gstPaise / 2);
      return { cgstAmount: this.fromPaise(cgstPaise), sgstAmount: this.fromPaise(gstPaise - cgstPaise), igstAmount: 0, classified: true };
    }
    return { cgstAmount: 0, sgstAmount: 0, igstAmount: this.fromPaise(gstPaise), classified: true };
  }

  async reviewItc(tenantId: string, userId: string, id: string, dto: ReviewPurchaseItcDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid tenant, user or purchase ID');
    }
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 5 || reason.length > 500) {
      throw new BadRequestException('ITC review reason must contain 5 to 500 characters');
    }
    const session = await this.purchases.db.startSession();
    let result: PurchaseDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const purchase = await this.purchases.findOne(
          tenantFilter(tenantId, { _id: new Types.ObjectId(id) }),
        ).session(session);
        if (!purchase) throw new NotFoundException('Purchase not found');
        if (purchase.status === 'CANCELLED') {
          throw new ConflictException('Cancelled purchases cannot be reviewed for input tax credit');
        }
        const previousStatus = purchase.itcReviewStatus || 'NOT_REVIEWED';
        const reviewedAt = new Date();
        purchase.itcReviewStatus = dto.status;
        purchase.itcReviewReason = reason;
        purchase.itcReviewedAt = reviewedAt;
        purchase.itcReviewedBy = new Types.ObjectId(userId);
        purchase.itcReviewHistory = purchase.itcReviewHistory || [];
        purchase.itcReviewHistory.push({
          previousStatus,
          status: dto.status,
          reason,
          reviewedBy: new Types.ObjectId(userId),
          reviewedAt,
        } as any);
        await purchase.save({ session });
        result = purchase;
      });
    } finally {
      await session.endSession();
    }
    if (!result) throw new Error('Purchase ITC review could not be saved');
    return result;
  }

  async itcReviewSummary(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant ID');
    const rows = await this.purchases.aggregate([
      { $match: { tenantId: new Types.ObjectId(tenantId), status: { $ne: 'CANCELLED' } } },
      { $group: {
        _id: { $ifNull: ['$itcReviewStatus', 'NOT_REVIEWED'] },
        purchaseCount: { $sum: 1 },
        gstAmount: { $sum: { $ifNull: ['$gstTotal', 0] } },
      } },
    ]);
    const statuses = ['NOT_REVIEWED', 'PENDING_DOCUMENTS', 'ELIGIBLE', 'INELIGIBLE', 'DISPUTED'];
    const byStatus = Object.fromEntries(statuses.map((status) => {
      const row = rows.find((item: any) => item._id === status);
      return [status, { purchaseCount: row?.purchaseCount || 0, gstAmount: row?.gstAmount || 0 }];
    }));
    return {
      byStatus,
      totals: rows.reduce((sum: any, row: any) => ({
        purchaseCount: sum.purchaseCount + row.purchaseCount,
        gstAmount: Number((sum.gstAmount + row.gstAmount).toFixed(2)),
      }), { purchaseCount: 0, gstAmount: 0 }),
      note: 'Review labels are user-entered workflow statuses only. They do not determine statutory ITC eligibility or replace GST compliance verification.',
    };
  }

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
        const tenant = await this.tenants.findById(new Types.ObjectId(tenantId)).select('stateCode').session(session).lean();
        const supplierGstin = supplier.gstin?.trim().toUpperCase() || null;
        const gstinStateCode = supplierGstin?.slice(0, 2) || null;
        if (supplier.stateCode && gstinStateCode && supplier.stateCode !== gstinStateCode) {
          throw new BadRequestException('Supplier state code does not match the GSTIN state prefix');
        }
        const supplierStateCode = supplier.stateCode || gstinStateCode || null;
        const placeOfSupplyStateCode = dto.placeOfSupplyStateCode || tenant?.stateCode || null;
        const supplierInvoiceDate = dto.supplierInvoiceDate ? new Date(`${dto.supplierInvoiceDate}T00:00:00.000Z`) : null;
        await this.taxPeriods.assertOpen(tenantId, supplierInvoiceDate || new Date(), session);
        if (supplierInvoiceDate && Number.isNaN(supplierInvoiceDate.getTime())) {
          throw new BadRequestException('Invalid supplier invoice date');
        }

        const items = [];
        let subtotal = 0;
        let gstTotal = 0;
        let cgstTotal = 0;
        let sgstTotal = 0;
        let igstTotal = 0;
        let gstSplitClassified = true;

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
          const gstSplit = this.splitGst(gstAmount, supplierStateCode, placeOfSupplyStateCode);

          subtotal += taxableValue;
          gstTotal += gstAmount;
          cgstTotal += gstSplit.cgstAmount;
          sgstTotal += gstSplit.sgstAmount;
          igstTotal += gstSplit.igstAmount;
          gstSplitClassified = gstSplitClassified && gstSplit.classified;

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
            cgstAmount: gstSplit.cgstAmount,
            sgstAmount: gstSplit.sgstAmount,
            igstAmount: gstSplit.igstAmount,
            gstSplitClassified: gstSplit.classified,
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
          supplierInvoiceDate,
          items,
          subtotal: Number(subtotal.toFixed(2)),
          gstTotal: Number(gstTotal.toFixed(2)),
          cgstTotal: Number(cgstTotal.toFixed(2)),
          sgstTotal: Number(sgstTotal.toFixed(2)),
          igstTotal: Number(igstTotal.toFixed(2)),
          gstSplitClassified,
          supplierGstinSnapshot: supplier.gstin || null,
          supplierStateCodeSnapshot: supplierStateCode,
          placeOfSupplyStateCode,
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
      .update(JSON.stringify(dto.warehouseId ? { items: normalizedItems, warehouseId: dto.warehouseId } : normalizedItems))
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

        let selectedWarehouse: any = null;
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
            if (previousQty > 0 && !product.valuationInitialized) {
              throw new ConflictException(`Opening inventory valuation is required for ${line.name} before receiving more stock.`);
            }
            const previousValuePaise = previousQty > 0 ? this.toPaise(product.inventoryValue || 0) : 0;
            const receivedValuePaise = this.toPaise(line.unitCost) * quantity;
            const nextValuePaise = previousValuePaise + receivedValuePaise;
            const nextAverageCostPaise = newQty > 0 ? Math.round(nextValuePaise / newQty) : 0;

            const updated = await this.products.findOneAndUpdate(
              tenantFilter(tenantId, {
                _id: product._id,
                isDeleted: false,
                trackStock: true,
                stockQty: previousQty,
              }),
              { $set: {
                stockQty: newQty,
                inventoryValue: this.fromPaise(nextValuePaise),
                averageCost: this.fromPaise(nextAverageCostPaise),
                valuationInitialized: true,
              } },
              { new: true, session, runValidators: true },
            );

            if (!updated) throw new ConflictException(`Stock changed while receiving ${line.name}`);

            let movementPreviousQty = previousQty;
            let movementNewQty = newQty;
            if (selectedWarehouse) {
              const warehouseStock = await this.warehouseStocks.findOne(tenantFilter(tenantId, {
                warehouseId: selectedWarehouse._id, productId: product._id,
              })).session(session);
              const warehousePreviousQty = warehouseStock?.quantity || 0;
              const warehousePreviousValuePaise = this.toPaise(warehouseStock?.inventoryValue || 0);
              const warehouseReceivedValuePaise = receivedValuePaise;
              const warehouseNextQty = warehousePreviousQty + quantity;
              movementPreviousQty = warehousePreviousQty;
              movementNewQty = warehouseNextQty;
              const warehouseNextValuePaise = warehousePreviousValuePaise + warehouseReceivedValuePaise;
              if (warehouseStock) {
                const warehouseUpdated = await this.warehouseStocks.findOneAndUpdate(
                  tenantFilter(tenantId, { _id: warehouseStock._id, quantity: warehousePreviousQty }),
                  { $set: {
                    quantity: warehouseNextQty,
                    inventoryValue: this.fromPaise(warehouseNextValuePaise),
                    averageCost: this.fromPaise(Math.round(warehouseNextValuePaise / warehouseNextQty)),
                  } },
                  { new: true, session, runValidators: true },
                );
                if (!warehouseUpdated) throw new ConflictException(`Warehouse stock changed while receiving ${line.name}`);
              } else {
                await this.warehouseStocks.create([{
                  tenantId: new Types.ObjectId(tenantId), warehouseId: selectedWarehouse._id,
                  productId: product._id, quantity: warehouseNextQty,
                  inventoryValue: this.fromPaise(warehouseNextValuePaise),
                  averageCost: this.fromPaise(Math.round(warehouseNextValuePaise / warehouseNextQty)),
                }], { session });
              }
            }

            await this.movements.create([{
              tenantId: new Types.ObjectId(tenantId),
              productId: product._id,
              ...(selectedWarehouse ? { warehouseId: selectedWarehouse._id } : {}),
              type: 'IN',
              quantityDelta: quantity,
              previousQty: movementPreviousQty,
              newQty: movementNewQty,
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
          warehouseId: selectedWarehouse?._id ?? null,
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
        const existingPurchase = await this.purchases.findOne(
          tenantFilter(tenantId, { _id: new Types.ObjectId(id) }),
        ).session(session);
        if (!existingPurchase) return;
        await this.taxPeriods.assertOpen(
          tenantId,
          existingPurchase.supplierInvoiceDate || existingPurchase.purchaseDate,
          session,
        );
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
