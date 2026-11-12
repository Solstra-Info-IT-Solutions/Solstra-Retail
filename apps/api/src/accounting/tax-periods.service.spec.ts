import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TaxPeriodsService } from './tax-periods.service';

describe('TaxPeriodsService', () => {
  const tenantId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();

  it('uses India-local calendar months for tax-period keys', () => {
    const service = new TaxPeriodsService({} as any);
    expect(service.periodKey(new Date('2026-10-31T18:29:59.000Z'))).toBe('2026-10');
    expect(service.periodKey(new Date('2026-10-31T18:30:00.000Z'))).toBe('2026-11');
  });

  it('rejects malformed period keys', async () => {
    const service = new TaxPeriodsService({} as any);
    await expect(service.close(tenantId, userId, { period: '2026-13', reason: 'Month close' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid tenant identities before querying', async () => {
    const model = { find: jest.fn() };
    const service = new TaxPeriodsService(model as any);
    await expect(service.list('invalid')).rejects.toBeInstanceOf(BadRequestException);
    expect(model.find).not.toHaveBeenCalled();
  });

  it('rejects reopening a period that is not currently closed', async () => {
    const model = {
      findOneAndUpdate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    };
    const service = new TaxPeriodsService(model as any);
    await expect(service.reopen(tenantId, userId, { period: '2026-10', reason: 'Correction required' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects tax mutations when the matching period is closed', async () => {
    const model = {
      findOneAndUpdate: jest.fn().mockRejectedValue({ code: 11000 }),
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: 'CLOSED' }) }),
    };
    const service = new TaxPeriodsService(model as any);
    await expect(service.assertOpen(tenantId, new Date('2026-10-15T12:00:00.000Z')))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
