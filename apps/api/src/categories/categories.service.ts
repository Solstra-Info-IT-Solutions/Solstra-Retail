import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Category, CategoryDocument } from './schemas/category.schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { tenantFilter } from '../common/tenant-scoped.service';
import { Product, ProductDocument } from '../products/schemas/product.schema';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name)
    private readonly categories: Model<CategoryDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
  ) {}

  async create(tenantId: string, dto: CreateCategoryDto) {
    this.validateTenant(tenantId);
    const name = dto.name.trim();
    if (name.length < 2 || name.length > 100) {
      throw new BadRequestException('Category name must be between 2 and 100 characters');
    }

    try {
      return await this.categories.create({
        tenantId: new Types.ObjectId(tenantId),
        name,
        normalizedName: name.toLowerCase(),
        description: dto.description?.trim() || '',
      });
    } catch (error: any) {
      this.handleDatabaseError(error);
    }
  }

  async findAll(tenantId: string) {
    this.validateTenant(tenantId);
    const items = await this.categories
      .find(tenantFilter(tenantId, { isDeleted: false }))
      .sort({ name: 1 })
      .lean();

    return { items, total: items.length };
  }

  async findOne(tenantId: string, id: string) {
    const categoryId = this.validateId(id);
    const category = await this.categories
      .findOne(tenantFilter(tenantId, { _id: categoryId, isDeleted: false }))
      .lean();

    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(tenantId: string, id: string, dto: UpdateCategoryDto) {
    const categoryId = this.validateId(id);
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one category field must be provided');
    }
    const updates: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.length < 2 || name.length > 100) {
        throw new BadRequestException('Category name must be between 2 and 100 characters');
      }
    if (name.length < 2 || name.length > 100) {
      throw new BadRequestException('Category name must be between 2 and 100 characters');
    }
      updates.name = name;
      updates.normalizedName = name.toLowerCase();
    }

    if (dto.description !== undefined) {
      updates.description = dto.description.trim();
    }

    try {
      const category = await this.categories.findOneAndUpdate(
        tenantFilter(tenantId, {
          _id: categoryId,
          isDeleted: false,
        }),
        { $set: updates },
        { new: true, runValidators: true },
      );

      if (!category) throw new NotFoundException('Category not found');

      if (dto.name !== undefined) {
        await this.products.updateMany(
          tenantFilter(tenantId, {
            categoryId,
            isDeleted: false,
          }),
          { $set: { category: category.name } },
        );
      }

      return category;
    } catch (error: any) {
      this.handleDatabaseError(error);
    }
  }

  async remove(tenantId: string, id: string) {
    const categoryId = this.validateId(id);
    const category = await this.categories.findOneAndUpdate(
      tenantFilter(tenantId, { _id: categoryId, isDeleted: false }),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );

    if (!category) throw new NotFoundException('Category not found');

    await this.products.updateMany(
      tenantFilter(tenantId, { categoryId }),
      { $unset: { categoryId: 1 } },
    );

    return {
      message: 'Category deleted successfully',
      categoryId: String(category._id),
    };
  }

  private validateTenant(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('Invalid tenant');
    }
  }

  private validateId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid category ID');
    }
    return new Types.ObjectId(id);
  }

  private handleDatabaseError(error: any): never {
    if (error?.code === 11000) {
      throw new ConflictException(
        'A category with this name already exists in this workspace',
      );
    }
    throw error;
  }
}





