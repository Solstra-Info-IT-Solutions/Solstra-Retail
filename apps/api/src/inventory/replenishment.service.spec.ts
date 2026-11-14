import { BadRequestException } from '@nestjs/common';
import { ReplenishmentService } from './replenishment.service';

describe('ReplenishmentService', () => {
  const tenantId = '507f1f77bcf86cd799439011';
  const productId = '507f1f77bcf86cd799439012';
  const warehouseId = '507f1f77bcf86cd799439013';
  let policies: any;
  let stocks: any;
  let sales: any;
  let service: ReplenishmentService;

  beforeEach(() => {
    policies = { find: jest.fn() };
    stocks = { find: jest.fn() };
    sales = { aggregate: jest.fn() };
    service = new ReplenishmentService(
      policies,
      {} as any,
      {} as any,
      stocks,
      sales,
      {} as any,
    );
  });

  it('rejects invalid tenant identifiers before querying policies', async () => {
    await expect(service.suggestions('invalid-tenant', {})).rejects.toThrow(BadRequestException);
    expect(policies.find).not.toHaveBeenCalled();
  });

  it('rejects invalid warehouse filters before querying policies', async () => {
    await expect(service.suggestions(tenantId, { warehouseId: 'invalid' })).rejects.toThrow(BadRequestException);
    expect(policies.find).not.toHaveBeenCalled();
  });

  it('calculates demand, lead-time buffer and pack-size rounded reorder quantities', async () => {
    const policy = {
      _id: '507f1f77bcf86cd799439014',
      productId: { _id: productId, name: 'Test Product', sku: 'SKU-1', unit: 'pcs' },
      warehouseId: { _id: warehouseId, name: 'Main Warehouse', code: 'MAIN' },
      preferredSupplierId: null,
      reorderPoint: 6,
      targetStock: 12,
      safetyStock: 2,
      leadTimeDays: 5,
      minimumOrderQty: 5,
      packSize: 6,
    };
    const policyQuery = {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([policy]),
    };
    const stockQuery = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ warehouseId, productId, quantity: 4 }]),
    };
    policies.find.mockReturnValue(policyQuery);
    stocks.find.mockReturnValue(stockQuery);
    sales.aggregate.mockResolvedValue([{ _id: productId, unitsSold: 90 }]);

    const result = await service.suggestions(tenantId, { lookbackDays: 90, forecastDays: 30 });

    expect(result.summary.reorderRequired).toBe(1);
    expect(result.items[0].averageDailyDemand).toBe(1);
    expect(result.items[0].leadTimeDemand).toBe(5);
    expect(result.items[0].forecastDemand).toBe(30);
    expect(result.items[0].suggestedOrderQty).toBe(12);
    expect(result.items[0].status).toBe('REORDER');
  });

  it('returns an empty forecast without querying stock or sales when no policies exist', async () => {
    const policyQuery = {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    policies.find.mockReturnValue(policyQuery);

    const result = await service.suggestions(tenantId, {});

    expect(result.summary).toEqual({ policies: 0, reorderRequired: 0, recommendedUnits: 0 });
    expect(result.items).toEqual([]);
    expect(stocks.find).not.toHaveBeenCalled();
    expect(sales.aggregate).not.toHaveBeenCalled();
  });
});
