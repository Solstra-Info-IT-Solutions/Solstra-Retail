import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { tenantFilter } from '../common/tenant-scoped.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSuppliersDto } from './dto/list-suppliers.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { Supplier, SupplierDocument } from './schemas/supplier.schema';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectModel(Supplier.name)
    private readonly suppliers: Model<SupplierDocument>,
  ) {}

  async create(tenantId: string, dto: CreateSupplierDto) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('Invalid tenant');
    }

    return this.suppliers.create({
      ...dto,
      tenantId: new Types.ObjectId(tenantId),
      phone: dto.phone?.trim() || undefined,
      email: dto.email?.trim().toLowerCase() || undefined,
      gstin: dto.gstin?.trim().toUpperCase() || undefined,
    });
  }

  async findAll(tenantId: string, query: ListSuppliersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: Record<string, unknown> = { isDeleted: false };

    if (query.search?.trim()) {
      const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { contactPerson: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { gstin: { $regex: escaped, $options: 'i' } },
      ];
    }

    const scopedFilter = tenantFilter(tenantId, filter);
    const [items, total] = await Promise.all([
      this.suppliers.find(scopedFilter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.suppliers.countDocuments(scopedFilter),
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

  async findOne(tenantId: string, id: string) {
    const supplierId = this.validateId(id);
    const supplier = await this.suppliers.findOne(
      tenantFilter(tenantId, { _id: supplierId, isDeleted: false }),
    ).lean();

    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async update(tenantId: string, id: string, dto: UpdateSupplierDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one supplier field must be provided');
    }
    const supplierId = this.validateId(id);
    const update: Record<string, unknown> = { ...dto };

    if (dto.phone !== undefined) update.phone = dto.phone.trim() || undefined;
    if (dto.email !== undefined) update.email = dto.email.trim().toLowerCase() || undefined;
    if (dto.gstin !== undefined) update.gstin = dto.gstin.trim().toUpperCase() || undefined;

    const supplier = await this.suppliers.findOneAndUpdate(
      tenantFilter(tenantId, { _id: supplierId, isDeleted: false }),
      { $set: update },
      { new: true, runValidators: true },
    );

    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async remove(tenantId: string, id: string) {
    const supplierId = this.validateId(id);
    const supplier = await this.suppliers.findOneAndUpdate(
      tenantFilter(tenantId, { _id: supplierId, isDeleted: false }),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );

    if (!supplier) throw new NotFoundException('Supplier not found');

    return {
      message: 'Supplier deleted successfully',
      supplierId: String(supplier._id),
    };
  }

  private validateId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid supplier ID');
    }
    return new Types.ObjectId(id);
  }
}

