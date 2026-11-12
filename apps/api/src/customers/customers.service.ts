import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { tenantFilter } from '../common/tenant-scoped.service';
import { SalesInvoice } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customers: Model<CustomerDocument>,

    @InjectModel(SalesInvoice.name)
    private readonly invoices: Model<SalesInvoice>,
  ) {}

  async create(tenantId: string, dto: CreateCustomerDto) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('Invalid tenant');
    }

    try {
      const customer = await this.customers.create({
        ...dto,
        tenantId: new Types.ObjectId(tenantId),
        phone: dto.phone?.trim() || undefined,
        email: dto.email?.trim().toLowerCase() || undefined,
        gstin: dto.gstin?.trim().toUpperCase() || undefined,
      });

      return customer;
    } catch (error: any) {
      this.handleDatabaseError(error);
    }
  }

  async findAll(tenantId: string, query: ListCustomersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: Record<string, unknown> = { isDeleted: false };

    if (query.search?.trim()) {
      const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { gstin: { $regex: escaped, $options: 'i' } },
      ];
    }

    const scopedFilter = tenantFilter(tenantId, filter);

    const [items, total] = await Promise.all([
      this.customers
        .find(scopedFilter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.customers.countDocuments(scopedFilter),
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
    const customerId = this.validateId(id);

    const customer = await this.customers
      .findOne(tenantFilter(tenantId, {
        _id: customerId,
        isDeleted: false,
      }))
      .lean();

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    const customerId = this.validateId(id);

    const update: Record<string, unknown> = { ...dto };

    if (dto.phone !== undefined) {
      update.phone = dto.phone.trim() || undefined;
    }
    if (dto.email !== undefined) {
      update.email = dto.email.trim().toLowerCase() || undefined;
    }
    if (dto.gstin !== undefined) {
      update.gstin = dto.gstin.trim().toUpperCase() || undefined;
    }

    try {
      const customer = await this.customers.findOneAndUpdate(
        tenantFilter(tenantId, {
          _id: customerId,
          isDeleted: false,
        }),
        { $set: update },
        { new: true, runValidators: true },
      );

      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      return customer;
    } catch (error: any) {
      this.handleDatabaseError(error);
    }
  }

  async remove(tenantId: string, id: string) {
    const customerId = this.validateId(id);

    const customer = await this.customers.findOneAndUpdate(
      tenantFilter(tenantId, {
        _id: customerId,
        isDeleted: false,
      }),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return {
      message: 'Customer deleted successfully',
      customerId: String(customer._id),
    };
  }

  async findSalesHistory(
    tenantId: string,
    id: string,
    page = 1,
    limit = 20,
  ) {
    const customerId = this.validateId(id);

    await this.findOne(tenantId, id);

    const filter = tenantFilter(tenantId, { customerId });

    const [items, total, summary] = await Promise.all([
      this.invoices
        .find(filter)
        .sort({ invoiceDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      this.invoices.countDocuments(filter),

      this.invoices.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            invoiceCount: { $sum: 1 },
            totalBilled: {
              $sum: {
                $cond: [{ $eq: ['$status', 'ISSUED'] }, '$grandTotal', 0],
              },
            },
            totalPaid: {
              $sum: {
                $cond: [{ $eq: ['$status', 'ISSUED'] }, '$paidAmount', 0],
              },
            },
            totalDue: {
              $sum: {
                $cond: [{ $eq: ['$status', 'ISSUED'] }, '$dueAmount', 0],
              },
            },
          },
        },
      ]),
    ]);

    return {
      items,
      summary: summary[0] ?? {
        invoiceCount: 0,
        totalBilled: 0,
        totalPaid: 0,
        totalDue: 0,
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private validateId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid customer ID');
    }
    return new Types.ObjectId(id);
  }

  private handleDatabaseError(error: any): never {
    if (error?.code === 11000) {
      throw new ConflictException(
        'A customer with this phone number or email already exists in this workspace',
      );
    }
    throw error;
  }
}
