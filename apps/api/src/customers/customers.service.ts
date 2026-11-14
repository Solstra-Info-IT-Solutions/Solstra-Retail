import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';

import { tenantFilter } from '../common/tenant-scoped.service';
import { SalesInvoice } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';
import { LoyaltyLedger, LoyaltyLedgerDocument } from './schemas/loyalty-ledger.schema';
import { AdjustLoyaltyPointsDto } from './dto/adjust-loyalty-points.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(LoyaltyLedger.name) private readonly loyaltyLedger: Model<LoyaltyLedgerDocument>,
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

  async getLoyalty(tenantId: string, id: string, page = 1, limit = 20) {
    const customerId = this.validateId(id);
    const customer = await this.findOne(tenantId, id);
    const filter = tenantFilter(tenantId, { customerId });
    const [items, total] = await Promise.all([
      this.loyaltyLedger.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.loyaltyLedger.countDocuments(filter),
    ]);
    return {
      customer: {
        id: String(customer._id),
        name: customer.name,
        pointsBalance: customer.loyaltyPoints ?? 0,
        lifetimePoints: customer.lifetimeLoyaltyPoints ?? 0,
        tier: customer.loyaltyTier ?? 'BRONZE',
        nextTier: this.nextTier(customer.lifetimeLoyaltyPoints ?? 0),
      },
      items,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      earningRule: '1 point for every ₹100 of taxable invoice value; GST is excluded. Points are rounded down per invoice.',
    };
  }

  async adjustLoyaltyPoints(tenantId: string, userId: string, id: string, dto: AdjustLoyaltyPointsDto) {
    const customerId = this.validateId(id);
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid tenant or user identity');
    }
    if (!Number.isInteger(dto.pointsDelta) || dto.pointsDelta === 0) {
      throw new BadRequestException('Points adjustment must be a non-zero whole number');
    }
    const reason = dto.reason.trim();
    if (reason.length < 5 || reason.length > 250) throw new BadRequestException('Adjustment reason must contain 5 to 250 characters');
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const customer = await this.customers.findOne(tenantFilter(tenantId, { _id: customerId, isDeleted: false })).session(session);
        if (!customer) throw new NotFoundException('Customer not found');
        const nextBalance = (customer.loyaltyPoints ?? 0) + dto.pointsDelta;
        if (nextBalance < 0) throw new BadRequestException('Points adjustment cannot make the customer balance negative');
        const lifetime = (customer.lifetimeLoyaltyPoints ?? 0) + Math.max(0, dto.pointsDelta);
        customer.loyaltyPoints = nextBalance;
        customer.lifetimeLoyaltyPoints = lifetime;
        customer.loyaltyTier = this.tierFor(lifetime);
        await customer.save({ session });
        const [entry] = await this.loyaltyLedger.create([{
          tenantId: new Types.ObjectId(tenantId),
          customerId,
          eventType: 'MANUAL_ADJUSTMENT',
          sourceType: 'MANUAL',
          sourceId: new Types.ObjectId().toString(),
          points: Math.abs(dto.pointsDelta),
          pointsDelta: dto.pointsDelta,
          balanceAfter: nextBalance,
          reason,
          createdBy: new Types.ObjectId(userId),
        }], { session });
        result = { customer: { id: String(customer._id), pointsBalance: nextBalance, lifetimePoints: lifetime, tier: customer.loyaltyTier }, entry };
      });
      return result;
    } finally { await session.endSession(); }
  }

  private tierFor(points: number): 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' {
    if (points >= 5000) return 'PLATINUM';
    if (points >= 2000) return 'GOLD';
    if (points >= 500) return 'SILVER';
    return 'BRONZE';
  }

  private nextTier(points: number) {
    if (points >= 5000) return null;
    if (points >= 2000) return { tier: 'PLATINUM', pointsRequired: 5000 - points };
    if (points >= 500) return { tier: 'GOLD', pointsRequired: 2000 - points };
    return { tier: 'SILVER', pointsRequired: 500 - points };
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
