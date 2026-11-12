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

@Injectable()
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name) private readonly purchases: Model<PurchaseDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Supplier.name) private readonly suppliers: Model<SupplierDocument>,
    @InjectModel(InventoryMovement.name) private readonly movements: Model<InventoryMovementDocument>,
  ) {}

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
          status: 'DRAFT',
          notes: dto.notes?.trim() ?? '',
          receipts: [],
          createdBy: new Types.ObjectId(userId),
        }], { session });

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

    const purchase = await this.purchases.findOneAndUpdate(
      tenantFilter(tenantId, {
        _id: new Types.ObjectId(id),
        status: 'DRAFT',
      }),
      {
        $set: {
          status: 'CANCELLED',
          cancelledBy: new Types.ObjectId(userId),
          cancelledAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    );

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


