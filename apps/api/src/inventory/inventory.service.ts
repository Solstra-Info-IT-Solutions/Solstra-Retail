import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Product, ProductDocument } from '../products/schemas/product.schema';
import { tenantFilter } from '../common/tenant-scoped.service';
import {
  InventoryMovement,
  InventoryMovementDocument,
} from './schemas/inventory-movement.schema';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto';
import { ListInventoryMovementsDto } from './dto/list-inventory-movements.dto';
import { AccountingService } from '../accounting/accounting.service';

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,

    @InjectModel(InventoryMovement.name)
    private readonly movements: Model<InventoryMovementDocument>,
    private readonly accounting: AccountingService,
  ) {}

  async createMovement(
  tenantId: string,
  userId: string,
  productId: string,
  dto: CreateInventoryMovementDto,
) {
  if (!Types.ObjectId.isValid(userId)) {
    throw new BadRequestException('Invalid authenticated user');
  }

  if (!Types.ObjectId.isValid(productId)) {
    throw new BadRequestException('Invalid product ID');
  }

  if (dto.type !== 'ADJUSTMENT' && dto.quantity < 1) {
    throw new BadRequestException(
      'Stock received or removed must be at least one unit',
    );
  }

  const session = await this.products.db.startSession();
  let result: InventoryMovementDocument | null = null;

  try {
    await session.withTransaction(async () => {
      const product = await this.products.findOne(
        tenantFilter(tenantId, {
          _id: new Types.ObjectId(productId),
          isDeleted: false,
        }),
      ).session(session);

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      if (!product.trackStock) {
        throw new BadRequestException(
          'Stock tracking is disabled for this product',
        );
      }

      const previousQty = product.stockQty;
      if (previousQty > 0 && !product.valuationInitialized) {
        throw new ConflictException('Opening inventory valuation must be initialized before adjusting existing stock.');
      }
      const unitCostPaise = Math.round((((product.valuationInitialized ? product.averageCost : product.purchasePrice) || 0) + Number.EPSILON) * 100);
      let newQty = previousQty;

      if (dto.type === 'IN') {
        newQty += dto.quantity;
      } else if (dto.type === 'OUT') {
        newQty -= dto.quantity;
      } else {
        newQty = dto.quantity;
      }

      if (newQty < 0) {
        throw new BadRequestException(
          'Insufficient stock. Negative stock is not allowed.',
        );
      }

      if (newQty === previousQty) {
        throw new BadRequestException(
          'Stock quantity has not changed',
        );
      }

      const quantityDelta = newQty - previousQty;
      const previousValuePaise = Math.round(((product.inventoryValue || 0) + Number.EPSILON) * 100);
      const newValuePaise = previousValuePaise + quantityDelta * unitCostPaise;
      if (newValuePaise < 0) {
        throw new BadRequestException('Inventory valuation cannot become negative.');
      }
      const updatedProduct = await this.products.findOneAndUpdate(
        tenantFilter(tenantId, {
          _id: product._id,
          isDeleted: false,
          stockQty: previousQty,
          trackStock: true,
        }),
        { $set: {
          stockQty: newQty,
          inventoryValue: newValuePaise / 100,
          averageCost: unitCostPaise / 100,
          valuationInitialized: true,
        } },
        {
          new: true,
          session,
          runValidators: true,
        },
      );

      if (!updatedProduct) {
        throw new ConflictException(
          'Stock changed during this operation. Please retry.',
        );
      }

      const [movement] = await this.movements.create(
        [{
          tenantId: new Types.ObjectId(tenantId),
          productId: product._id,
          type: dto.type,
          quantityDelta: newQty - previousQty,
          previousQty,
          newQty,
          reason: dto.reason.trim(),
          performedBy: new Types.ObjectId(userId),
        }],
        { session },
      );

      const adjustmentValuePaise = Math.abs(quantityDelta) * unitCostPaise;
      if (adjustmentValuePaise > 0) {
        const increase = quantityDelta > 0;
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: new Date(),
          narration: `Inventory ${dto.type.toLowerCase()} - ${product.name}: ${dto.reason.trim()}`,
          sourceType: 'INVENTORY', sourceId: `STOCK_MOVEMENT:${movement._id.toString()}`,
          lines: increase
            ? [
                { accountCode: '1200', debit: adjustmentValuePaise / 100, credit: 0, description: 'Inventory increase' },
                { accountCode: '5500', debit: 0, credit: adjustmentValuePaise / 100, description: 'Inventory gain / stock-in adjustment' },
              ]
            : [
                { accountCode: '5400', debit: adjustmentValuePaise / 100, credit: 0, description: 'Inventory shrinkage / stock-out adjustment' },
                { accountCode: '1200', debit: 0, credit: adjustmentValuePaise / 100, description: 'Inventory decrease' },
              ],
          session,
        });
      }

      result = movement;
    });
  } finally {
    await session.endSession();
  }

  if (!result) {
    throw new Error('Inventory movement could not be created');
  }

  return result;
}

  async findAll(
    tenantId: string,
    query: ListInventoryMovementsDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: Record<string, unknown> = {};

    if (query.productId) {
      if (!Types.ObjectId.isValid(query.productId)) {
        throw new BadRequestException('Invalid product ID');
      }

      filter.productId = new Types.ObjectId(query.productId);
    }

    const scopedFilter = tenantFilter(tenantId, filter);

    const [items, total] = await Promise.all([
      this.movements
        .find(scopedFilter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('productId', 'name sku barcode')
        .populate('warehouseId', 'name code')
        .populate('transferId', 'quantity sourceWarehouseId destinationWarehouseId')
        .populate('performedBy', 'name email')
        .lean(),

      this.movements.countDocuments(scopedFilter),
    ]);

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}