import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PurchasesService } from './purchases.service';

describe('PurchasesService validation', () => {
  const tenantId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();
  const supplierId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId().toString();

  const createService = () => {
    const purchases = {
      db: { startSession: jest.fn() },
    };

    const service = new PurchasesService(
      purchases as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, purchases };
  };

  it('rejects duplicate product lines in a purchase', async () => {
    const { service, purchases } = createService();

    await expect(
      service.create(tenantId, userId, {
        supplierId,
        items: [
          { productId, quantity: 2, unitCost: 10, gstRate: 5 },
          { productId: productId.toUpperCase(), quantity: 3, unitCost: 10, gstRate: 5 },
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(purchases.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects invalid authenticated user IDs', async () => {
    const { service, purchases } = createService();

    await expect(
      service.create(tenantId, 'invalid-user', {
        supplierId,
        items: [{ productId, quantity: 1, unitCost: 10, gstRate: 5 }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(purchases.db.startSession).not.toHaveBeenCalled();
  });
});
