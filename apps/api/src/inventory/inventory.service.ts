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

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,

    @InjectModel(InventoryMovement.name)
    private readonly movements: Model<InventoryMovementDocument>,
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

      const updatedProduct = await this.products.findOneAndUpdate(
        tenantFilter(tenantId, {
          _id: product._id,
          isDeleted: false,
          stockQty: previousQty,
          trackStock: true,
        }),
        { $set: { stockQty: newQty } },
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