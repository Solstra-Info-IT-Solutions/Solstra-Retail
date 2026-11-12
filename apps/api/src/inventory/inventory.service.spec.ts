import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let products: any;
  let movements: any;

  beforeEach(() => {
    products = {
      db: {
        startSession: jest.fn(),
      },
    };

    movements = {};

    service = new InventoryService(products, movements);
  });

  it('rejects an invalid authenticated user before starting a transaction', async () => {
    await expect(
      service.createMovement(
        '507f1f77bcf86cd799439011',
        'invalid-user',
        '507f1f77bcf86cd799439012',
        { type: 'IN', quantity: 5, reason: 'Stock received' } as any,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(products.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects an invalid product ID before starting a transaction', async () => {
    await expect(
      service.createMovement(
        '507f1f77bcf86cd799439011',
        '507f1f77bcf86cd799439012',
        'invalid-product',
        { type: 'IN', quantity: 5, reason: 'Stock received' } as any,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(products.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects zero quantity for IN movements before starting a transaction', async () => {
    await expect(
      service.createMovement(
        '507f1f77bcf86cd799439011',
        '507f1f77bcf86cd799439012',
        '507f1f77bcf86cd799439013',
        { type: 'IN', quantity: 0, reason: 'Stock received' } as any,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(products.db.startSession).not.toHaveBeenCalled();
  });
});
