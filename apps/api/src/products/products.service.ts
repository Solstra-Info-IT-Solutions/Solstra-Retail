import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Product, ProductDocument } from './schemas/product.schema';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsDto } from './dto/list-products.dto';
import { InitializeProductValuationDto } from './dto/initialize-product-valuation.dto';
import { tenantFilter } from '../common/tenant-scoped.service';
import { AccountingService } from '../accounting/accounting.service';
import { Category, CategoryDocument } from '../categories/schemas/category.schema';
import {
  InventoryMovement,
  InventoryMovementDocument,
} from '../inventory/schemas/inventory-movement.schema';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(InventoryMovement.name)
    private readonly movements: Model<InventoryMovementDocument>,
    @InjectModel(Category.name)
    private readonly categories: Model<CategoryDocument>,
    private readonly accounting: AccountingService,
  ) {}

  async create(
  tenantId: string,
  userId: string,
  dto: CreateProductDto,
) {
  if (!Types.ObjectId.isValid(tenantId)) {
    throw new BadRequestException('Invalid tenant');
  }

  if (!Types.ObjectId.isValid(userId)) {
    throw new BadRequestException('Invalid user');
  }

  const categoryData = await this.resolveCategory(tenantId, dto.categoryId);

  const session = await this.products.db.startSession();

  let createdProduct: ProductDocument | null = null;

  try {
    await session.withTransaction(async () => {
      const [product] = await this.products.create(
        [{
          ...dto,
          ...categoryData,
          averageCost: dto.purchasePrice,
          inventoryValue: dto.trackStock === false ? 0 : Number(((dto.stockQty ?? 0) * dto.purchasePrice).toFixed(2)),
          valuationInitialized: dto.trackStock !== false,
          tenantId: new Types.ObjectId(tenantId),
        }],
        { session },
      );

      if (product.stockQty > 0) {
        await this.movements.create(
          [{
            tenantId: new Types.ObjectId(tenantId),
            productId: product._id,
            type: 'OPENING',
            quantityDelta: product.stockQty,
            previousQty: 0,
            newQty: product.stockQty,
            reason: 'Opening stock at product creation',
            performedBy: new Types.ObjectId(userId),
          }],
          { session },
        );
      }

      if (product.trackStock && product.stockQty > 0) {
        const openingValue = Number((product.stockQty * product.averageCost).toFixed(2));
        if (openingValue > 0) await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: new Date(),
          narration: `Opening inventory for product ${product.name}`,
          sourceType: 'INVENTORY', sourceId: `PRODUCT_OPENING:${product._id.toString()}`,
          lines: [
            { accountCode: '1200', debit: openingValue, credit: 0, description: 'Opening inventory asset' },
            { accountCode: '3200', debit: 0, credit: openingValue, description: 'Opening balance equity' },
          ],
          session,
        });
      }

      createdProduct = product;
    });
  } catch (error: any) {
    this.handleDatabaseError(error);
  } finally {
    await session.endSession();
  }

  if (!createdProduct) {
    throw new Error('Product creation failed');
  }

  return createdProduct;
}

  async initializeValuation(tenantId: string, userId: string, id: string, dto: InitializeProductValuationDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid tenant, user or product ID');
    }
    if (!Number.isFinite(dto.unitCost) || dto.unitCost < 0 || !dto.reason?.trim()) {
      throw new BadRequestException('A valid non-negative unit cost and reconciliation reason are required');
    }
    const session = await this.products.db.startSession();
    let initialized: ProductDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const product = await this.products.findOne(tenantFilter(tenantId, {
          _id: new Types.ObjectId(id), isDeleted: false, trackStock: true,
        })).session(session);
        if (!product) throw new NotFoundException('Stock-tracked product not found');
        if (product.valuationInitialized) {
          throw new ConflictException('Inventory valuation has already been initialized for this product');
        }
        const unitCostPaise = Math.round((dto.unitCost + Number.EPSILON) * 100);
        const openingValuePaise = unitCostPaise * product.stockQty;
        const updated = await this.products.findOneAndUpdate(
          tenantFilter(tenantId, {
            _id: product._id, isDeleted: false, valuationInitialized: { $ne: true },
            stockQty: product.stockQty,
          }),
          { $set: {
            averageCost: unitCostPaise / 100,
            inventoryValue: openingValuePaise / 100,
            valuationInitialized: true,
          } },
          { new: true, session, runValidators: true },
        );
        if (!updated) throw new ConflictException('Product stock changed during valuation reconciliation');
        if (openingValuePaise > 0) {
          await this.accounting.postOperationalJournal({
            tenantId, userId, postingDate: new Date(),
            narration: `Opening inventory valuation: ${product.name} - ${dto.reason.trim()}`,
            sourceType: 'INVENTORY',
            sourceId: `PRODUCT_VALUATION_OPENING:${product._id.toString()}`,
            lines: [
              { accountCode: '1200', debit: openingValuePaise / 100, credit: 0, description: 'Recognize opening inventory asset' },
              { accountCode: '3200', debit: 0, credit: openingValuePaise / 100, description: 'Opening balance equity' },
            ],
            session,
          });
        }
        initialized = updated;
      });
    } finally {
      await session.endSession();
    }
    if (!initialized) throw new Error('Inventory valuation initialization failed');
    return initialized;
  }

  async findAll(tenantId: string, query: ListProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: Record<string, unknown> = {
      isDeleted: false,
    };

    if (query.category?.trim()) {
      filter.category = query.category.trim();
    }

    if (query.search?.trim()) {
      const escapedSearch = query.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { sku: { $regex: escapedSearch, $options: 'i' } },
        { barcode: { $regex: escapedSearch, $options: 'i' } },
        { category: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    const scopedFilter = tenantFilter(tenantId, filter);

    const [items, total] = await Promise.all([
      this.products
        .find(scopedFilter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      this.products.countDocuments(scopedFilter),
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

  
  async findLowStock(tenantId: string) {
    const filter = tenantFilter(tenantId, {
      isDeleted: false,
      trackStock: true,
      $expr: {
        $lte: ['$stockQty', '$lowStockThreshold'],
      },
    });

    const items = await this.products
      .find(filter)
      .sort({ stockQty: 1, name: 1 })
      .lean();

    return {
      items,
      total: items.length,
    };
  }


  async findOne(tenantId: string, id: string) {
    const productId = this.validateProductId(id);

    const product = await this.products
      .findOne(
        tenantFilter(tenantId, {
          _id: productId,
          isDeleted: false,
        }),
      )
      .lean();

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateProductDto,
  ) {
    const productId = this.validateProductId(id);
    const categoryData = await this.resolveCategory(tenantId, dto.categoryId);
    const updates = { ...dto, ...categoryData };

    try {
      const product = await this.products.findOneAndUpdate(
        tenantFilter(tenantId, {
          _id: productId,
          isDeleted: false,
        }),
        { $set: updates },
        {
          new: true,
          runValidators: true,
        },
      );

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      return product;
    } catch (error: any) {
      this.handleDatabaseError(error);
    }
  }

  async remove(tenantId: string, id: string) {
    const productId = this.validateProductId(id);

    const product = await this.products.findOneAndUpdate(
      tenantFilter(tenantId, {
        _id: productId,
        isDeleted: false,
      }),
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      message: 'Product deleted successfully',
      productId: String(product._id),
    };
  }

  private async resolveCategory(
    tenantId: string,
    categoryId?: string,
  ): Promise<Partial<{ categoryId: Types.ObjectId; category: string }>> {
    if (!categoryId) return {};

    if (!Types.ObjectId.isValid(categoryId)) {
      throw new BadRequestException('Invalid category ID');
    }

    const category = await this.categories.findOne(
      tenantFilter(tenantId, {
        _id: new Types.ObjectId(categoryId),
        isDeleted: false,
      }),
    );

    if (!category) {
      throw new BadRequestException(
        'Category not found in this workspace or it has been deleted',
      );
    }

    return {
      categoryId: category._id,
      category: category.name,
    };
  }

  private validateProductId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid product ID');
    }

    return new Types.ObjectId(id);
  }

  private handleDatabaseError(error: any): never {
    if (error?.code === 11000) {
      throw new ConflictException(
        'A product with this SKU or barcode already exists in this workspace',
      );
    }

    throw error;
  }
}








