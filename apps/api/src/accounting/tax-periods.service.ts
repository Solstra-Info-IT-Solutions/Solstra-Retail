import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { tenantFilter } from '../common/tenant-scoped.service';
import { TaxPeriod, TaxPeriodDocument } from './schemas/tax-period.schema';
import { TaxPeriodDto } from './dto/tax-period.dto';

@Injectable()
export class TaxPeriodsService {
  constructor(@InjectModel(TaxPeriod.name) private readonly periods: Model<TaxPeriodDocument>) {}

  private bounds(period: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException('Tax period must use YYYY-MM format');
    const [year, month] = period.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, month - 1, 1) - 330 * 60 * 1000);
    const endDate = new Date(Date.UTC(year, month, 1) - 330 * 60 * 1000 - 1);
    return { startDate, endDate };
  }

  periodKey(date: Date): string {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new BadRequestException('A valid tax date is required');
    const indiaDate = new Date(date.getTime() + 330 * 60 * 1000);
    return `${indiaDate.getUTCFullYear()}-${String(indiaDate.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async assertOpen(tenantId: string, taxDate: Date, session?: ClientSession) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    const periodKey = this.periodKey(taxDate);
    const { startDate, endDate } = this.bounds(periodKey);
    try {
      const period = await this.periods.findOneAndUpdate(
        tenantFilter(tenantId, { periodKey, status: { $ne: 'CLOSED' } }),
        { $setOnInsert: { tenantId: new Types.ObjectId(tenantId), periodKey, startDate, endDate, status: 'OPEN', events: [] }, $inc: { mutationVersion: 1 } },
        { upsert: true, new: true, session, setDefaultsOnInsert: true },
      ).lean();
      if (period) return;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const closed = await this.periods.findOne(tenantFilter(tenantId, { periodKey, status: 'CLOSED' })).session(session ?? null).lean();
    if (closed) throw new ConflictException(`GST period ${periodKey} is closed. Reopen it with an audited owner/admin action before changing tax records.`);
    throw new ConflictException('GST period changed concurrently. Retry the operation.');
  }

  async list(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    return this.periods.find(tenantFilter(tenantId, {})).sort({ startDate: -1 }).limit(36).lean();
  }

  async close(tenantId: string, userId: string, dto: TaxPeriodDto) {
    this.validateIdentity(tenantId, userId);
    const { startDate, endDate } = this.bounds(dto.period);
    const now = new Date();
    if (endDate >= now) throw new BadRequestException('A GST period can only be closed after the full calendar month has ended');
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('A closure reason of at least 3 characters is required');
    try {
      const period = await this.periods.findOneAndUpdate(
        tenantFilter(tenantId, { periodKey: dto.period, status: { $ne: 'CLOSED' } }),
        { $setOnInsert: { tenantId: new Types.ObjectId(tenantId), periodKey: dto.period, startDate, endDate, events: [] },
          $set: { status: 'CLOSED' },
          $inc: { mutationVersion: 1 },
          $push: { events: { action: 'CLOSED', at: now, by: new Types.ObjectId(userId), reason } } },
        { upsert: true, new: true, runValidators: true },
      ).lean();
      if (period) return period;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    throw new ConflictException('This GST period is already closed or was changed concurrently');
  }

  async reopen(tenantId: string, userId: string, dto: TaxPeriodDto) {
    this.validateIdentity(tenantId, userId);
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('A reopening reason of at least 3 characters is required');
    const period = await this.periods.findOneAndUpdate(
      tenantFilter(tenantId, { periodKey: dto.period, status: 'CLOSED' }),
      { $set: { status: 'OPEN' }, $inc: { mutationVersion: 1 },
        $push: { events: { action: 'REOPENED', at: new Date(), by: new Types.ObjectId(userId), reason } } },
      { new: true, runValidators: true },
    ).lean();
    if (!period) throw new ConflictException('Only a currently closed GST period can be reopened');
    return period;
  }

  private validateIdentity(tenantId: string, userId: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid tenant or user identity');
  }
}
