import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CustomersService } from './customers.service';

describe('CustomersService loyalty redemption and customer segmentation', () => {
  const tenantId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId();
  const voucherId = new Types.ObjectId();

  const createService = (points = 500) => {
    const customer: any = {
      _id: customerId,
      name: 'Test Customer',
      loyaltyPoints: points,
      lifetimeLoyaltyPoints: 700,
      loyaltyTier: 'SILVER',
      save: jest.fn().mockResolvedValue(undefined),
    };
    const session: any = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const connection: any = { startSession: jest.fn().mockResolvedValue(session) };
    const customers: any = {
      findOne: jest.fn().mockReturnValue({ session: jest.fn().mockResolvedValue(customer) }),
      aggregate: jest.fn().mockResolvedValue([]),
    };
    const voucher: any = {
      _id: voucherId,
      code: 'SRABCDEF123456',
      discountAmount: 10,
      status: 'AVAILABLE',
      expiresAt: new Date(Date.now() + 86400000),
    };
    const loyaltyVouchers: any = { create: jest.fn().mockResolvedValue([voucher]) };
    const loyaltyLedger: any = { create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]) };
    const invoices: any = {};
    const service = new CustomersService(connection, loyaltyLedger, loyaltyVouchers, customers, invoices);
    return { service, customer, session, customers, loyaltyVouchers, loyaltyLedger };
  };

  it('redeems points into a single-use voucher and writes the ledger atomically', async () => {
    const { service, customer, loyaltyVouchers, loyaltyLedger } = createService();
    const result = await service.redeemLoyaltyPoints(tenantId, userId, customerId.toString(), { points: 100 });
    expect(customer.loyaltyPoints).toBe(400);
    expect(customer.save).toHaveBeenCalled();
    expect(loyaltyVouchers.create).toHaveBeenCalledWith(
      [expect.objectContaining({ customerId, pointsRedeemed: 100, discountAmount: 10, status: 'AVAILABLE' })],
      expect.objectContaining({ session: expect.any(Object) }),
    );
    expect(loyaltyLedger.create).toHaveBeenCalledWith(
      [expect.objectContaining({ eventType: 'REDEEM', pointsDelta: -100, balanceAfter: 400 })],
      expect.objectContaining({ session: expect.any(Object) }),
    );
    expect(result.voucher.discountAmount).toBe(10);
  });

  it('rejects redemption when points are not in valid 100-point increments', async () => {
    const { service, loyaltyVouchers } = createService();
    await expect(service.redeemLoyaltyPoints(tenantId, userId, customerId.toString(), { points: 150 }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(loyaltyVouchers.create).not.toHaveBeenCalled();
  });

  it('rejects redemption above the available points balance', async () => {
    const { service, loyaltyVouchers } = createService(50);
    await expect(service.redeemLoyaltyPoints(tenantId, userId, customerId.toString(), { points: 100 }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(loyaltyVouchers.create).not.toHaveBeenCalled();
  });

  it('returns segment summary counts from tenant-scoped customer aggregation', async () => {
    const { service, customers } = createService();
    customers.aggregate.mockResolvedValue([{ _id: 'VIP', customerCount: 2, lifetimeSpend: 125000 }]);
    const result = await service.getCustomerSegments(tenantId);
    expect(result.segments.find((row) => row.segment === 'VIP')).toEqual({
      segment: 'VIP', customerCount: 2, lifetimeSpend: 125000,
    });
    expect(customers.aggregate).toHaveBeenCalled();
  });

  it('rejects unsupported customer segment names', async () => {
    const { service, customers } = createService();
    await expect(service.getSegmentCustomers(tenantId, 'UNKNOWN')).rejects.toBeInstanceOf(BadRequestException);
    expect(customers.aggregate).not.toHaveBeenCalled();
  });
});
