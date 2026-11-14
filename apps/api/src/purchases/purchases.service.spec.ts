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
      {} as any,
      {} as any,
      {} as any,
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


  it('splits GST into CGST and SGST for same-state purchases with paise precision', () => {
    const { service } = createService();
    expect((service as any).splitGst(18, '09', '09')).toEqual({
      cgstAmount: 9, sgstAmount: 9, igstAmount: 0, classified: true,
    });
    expect((service as any).splitGst(0.01, '09', '09')).toEqual({
      cgstAmount: 0, sgstAmount: 0.01, igstAmount: 0, classified: true,
    });
  });

  it('classifies inter-state purchase GST as IGST', () => {
    const { service } = createService();
    expect((service as any).splitGst(18, '27', '09')).toEqual({
      cgstAmount: 0, sgstAmount: 0, igstAmount: 18, classified: true,
    });
  });

  it('does not invent a GST split when either state code is unavailable', () => {
    const { service } = createService();
    expect((service as any).splitGst(18, null, '09')).toEqual({
      cgstAmount: 0, sgstAmount: 0, igstAmount: 0, classified: false,
    });
  });

  it('records ITC review decisions with a reason and append-only history', async () => {
    const { service, purchases } = createService();
    const session = {
      withTransaction: jest.fn(async (callback: () => Promise<void>) => callback()),
      endSession: jest.fn(),
    };
    const purchase: any = {
      status: 'RECEIVED',
      itcReviewStatus: 'NOT_REVIEWED',
      itcReviewHistory: [],
      save: jest.fn().mockResolvedValue(undefined),
    };
    purchases.db.startSession.mockResolvedValue(session as any);
    (purchases as any).findOne = jest.fn().mockReturnValue({
      session: jest.fn().mockResolvedValue(purchase),
    });

    const result = await service.reviewItc(tenantId, userId, new Types.ObjectId().toString(), {
      status: 'PENDING_DOCUMENTS',
      reason: 'Supplier invoice copy is awaited',
    });
    const reviewed = result as any;

    expect(reviewed.itcReviewStatus).toBe('PENDING_DOCUMENTS');
    expect(reviewed.itcReviewHistory).toHaveLength(1);
    expect(reviewed.itcReviewHistory[0]).toMatchObject({
      previousStatus: 'NOT_REVIEWED',
      status: 'PENDING_DOCUMENTS',
      reason: 'Supplier invoice copy is awaited',
    });
    expect(purchase.save).toHaveBeenCalledWith({ session });
    expect(session.endSession).toHaveBeenCalled();
  });

  it('rejects short ITC review reasons before opening a transaction', async () => {
    const { service, purchases } = createService();
    await expect(service.reviewItc(tenantId, userId, new Types.ObjectId().toString(), {
      status: 'ELIGIBLE',
      reason: 'no',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(purchases.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects invalid tenant IDs for ITC review summaries', async () => {
    const { service, purchases } = createService();
    await expect(service.itcReviewSummary('invalid-tenant'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(purchases.db.startSession).not.toHaveBeenCalled();
  });

});
