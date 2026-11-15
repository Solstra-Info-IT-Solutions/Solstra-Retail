import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let products: any;
  let movements: any;
  let accounting: any;

  beforeEach(() => {
    products = {
      db: {
        startSession: jest.fn(),
      },
    };

    movements = {};
    accounting = { postOperationalJournal: jest.fn() };

    service = new InventoryService(products, movements, accounting);
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

  it('persists integer-paise valuation snapshots for manual stock movements', async () => {
    const session = {
      withTransaction: jest.fn(async (callback: () => Promise<void>) => callback()),
      endSession: jest.fn(),
    };
    const product = {
      _id: '507f1f77bcf86cd799439013',
      name: 'Test product',
      trackStock: true,
      stockQty: 4,
      averageCost: 12.5,
      inventoryValue: 50,
      valuationInitialized: true,
    };
    products.db.startSession.mockResolvedValue(session);
    products.findOne = jest.fn().mockReturnValue({ session: jest.fn().mockResolvedValue(product) });
    products.findOneAndUpdate = jest.fn().mockResolvedValue({ ...product, stockQty: 6, inventoryValue: 75 });
    movements.create = jest.fn().mockResolvedValue([{ _id: 'movement-1' }]);

    await service.createMovement(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439012',
      '507f1f77bcf86cd799439013',
      { type: 'IN', quantity: 2, reason: 'Receipt' } as any,
    );

    expect(movements.create).toHaveBeenCalledWith(
      [expect.objectContaining({
        valuation: {
          unitCostPaise: 1250,
          productPreviousValuePaise: 5000,
          productValueDeltaPaise: 2500,
          productNewValuePaise: 7500,
        },
      })],
      { session },
    );
    expect(session.endSession).toHaveBeenCalled();
  });

});
