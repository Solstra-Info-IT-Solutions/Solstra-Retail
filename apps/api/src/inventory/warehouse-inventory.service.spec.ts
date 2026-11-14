import { BadRequestException } from '@nestjs/common';
import { WarehouseInventoryService } from './warehouse-inventory.service';

describe('WarehouseInventoryService', () => {
  let service: WarehouseInventoryService;
  let connection: any;

  beforeEach(() => {
    connection = { startSession: jest.fn() };
    service = new WarehouseInventoryService(
      connection,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
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
