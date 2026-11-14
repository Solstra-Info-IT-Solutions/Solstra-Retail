import { BadRequestException } from '@nestjs/common';
import { WarehouseInventoryService } from './warehouse-inventory.service';

describe('WarehouseInventoryService', () => {
  let service: WarehouseInventoryService;
  let connection: any;
  let products: any;
  let stocks: any;

  beforeEach(() => {
    connection = { startSession: jest.fn() };
    products = { find: jest.fn() };
    stocks = { find: jest.fn() };
    service = new WarehouseInventoryService(
      connection,
      products,
      {} as any,
      {} as any,
      stocks,
      {} as any,
      {} as any,
    );
  });


  it('reports unallocated stock separately from over-allocation discrepancies', async () => {
    const productQuery = { select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([
      { _id: '507f1f77bcf86cd799439021', name: 'Product A', stockQty: 10, inventoryValue: 100, valuationInitialized: true },
      { _id: '507f1f77bcf86cd799439022', name: 'Product B', stockQty: 4, inventoryValue: 40, valuationInitialized: true },
    ]) };
    const stockQuery = { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([
      { productId: '507f1f77bcf86cd799439021', quantity: 6, inventoryValue: 60 },
      { productId: '507f1f77bcf86cd799439022', quantity: 5, inventoryValue: 50 },
    ]) };
    products.find.mockReturnValue(productQuery);
    stocks.find.mockReturnValue(stockQuery);

    const result = await service.reconciliation('507f1f77bcf86cd799439011');
    expect(result.summary.unallocatedStock).toBe(4);
    expect(result.summary.discrepancies).toBe(1);
    expect(result.items[0].status).toBe('UNALLOCATED');
    expect(result.items[1].issues).toContain('OVER_ALLOCATED_QUANTITY');
    expect(result.items[1].issues).toContain('OVER_ALLOCATED_VALUE');
  });

  it('rejects invalid tenant and user identities before opening a transaction', async () => {
    await expect(
      service.initializeOpeningStock(
        'invalid-tenant',
        '507f1f77bcf86cd799439011',
        '507f1f77bcf86cd799439012',
        { productId: '507f1f77bcf86cd799439013', quantity: 2, reason: 'Opening allocation' } as any,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(connection.startSession).not.toHaveBeenCalled();
  });

  it('rejects invalid warehouse and product identifiers before opening a transaction', async () => {
    await expect(
      service.initializeOpeningStock(
        '507f1f77bcf86cd799439011',
        '507f1f77bcf86cd799439012',
        'invalid-warehouse',
        { productId: 'invalid-product', quantity: 2, reason: 'Opening allocation' } as any,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(connection.startSession).not.toHaveBeenCalled();
  });

  it('rejects transfers between the same warehouse before opening a transaction', async () => {
    const warehouseId = '507f1f77bcf86cd799439012';
    await expect(
      service.createTransfer(
        '507f1f77bcf86cd799439011',
        '507f1f77bcf86cd799439013',
        {
          productId: '507f1f77bcf86cd799439014',
          sourceWarehouseId: warehouseId,
          destinationWarehouseId: warehouseId,
          quantity: 1,
          reason: 'Internal movement',
        } as any,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(connection.startSession).not.toHaveBeenCalled();
  });
});
