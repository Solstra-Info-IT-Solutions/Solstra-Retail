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

  it('rejects invalid purchase payment identities before opening a transaction', async () => {
    const { service, purchases } = createService();

    await expect(
      service.addPayment(tenantId, userId, 'invalid-purchase', {
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        method: 'UPI',
        amount: 100,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(purchases.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects invalid supplier ledger identities', async () => {
    const { service, purchases } = createService();

    await expect(
      service.supplierLedger(tenantId, 'invalid-supplier', {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(purchases.db.startSession).not.toHaveBeenCalled();
  });

});
