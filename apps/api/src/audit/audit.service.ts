import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { tenantFilter } from '../common/tenant-scoped.service';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private readonly logs: Model<AuditLogDocument>) {}

  async record(input: {
    tenantId: string; actorId: string; actorRole: string; action: string;
    resource: string; resourceId?: string; route: string; ipAddress?: string; userAgent?: string;
  }) {
    if (!Types.ObjectId.isValid(input.tenantId) || !Types.ObjectId.isValid(input.actorId)) return;
    await this.logs.create({
      tenantId: new Types.ObjectId(input.tenantId),
      actorId: new Types.ObjectId(input.actorId),
      actorRole: input.actorRole,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId || '',
      route: input.route.slice(0, 300),
      ipAddress: (input.ipAddress || '').slice(0, 80),
      userAgent: (input.userAgent || '').slice(0, 300),
      occurredAt: new Date(),
    });
  }

  async list(tenantId: string, page = 1, limit = 50) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant context');
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 50));
    const filter = tenantFilter(tenantId, {});
    const [items, total] = await Promise.all([
      this.logs.find(filter).populate('actorId', 'name email').sort({ occurredAt: -1 })
        .skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      this.logs.countDocuments(filter),
    ]);
    return { items, pagination: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) } };
  }
}
