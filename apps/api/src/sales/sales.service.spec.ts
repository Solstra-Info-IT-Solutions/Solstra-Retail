import { createHash } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SalesService } from './sales.service';

describe('SalesService createSale idempotency', () => {
  const tenantId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId().toString();

  const createDto = () => ({
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    items: [{ productId, quantity: 2, discountAmount: 0 }],
    customerName: 'Test Customer',
    customerPhone: '9876543210',
    placeOfSupplyStateCode: '09',
    payments: [{ method: 'CASH' as const, amount: 50, reference: 'cash' }],
  });

  const fingerprint = (dto: ReturnType<typeof createDto>) => {
    const payload = {
      items: dto.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        discountAmount: item.discountAmount ?? 0,
      })),
      customerId: null,
      customerName: dto.customerName ?? '',
      customerPhone: dto.customerPhone ?? '',
      customerGstin: null,
      placeOfSupplyStateCode: dto.placeOfSupplyStateCode,
      payments: (dto.payments ?? []).map((payment) => ({
        method: payment.method,
        amountPaise: Math.round((payment.amount + Number.EPSILON) * 100),
        reference: payment.reference ?? '',
      })),
    };

    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  };

  const createService = (existingInvoice: any) => {
    const invoices = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(existingInvoice),
      }),
    };

    const service = new SalesService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      invoices as any,
      {} as any,
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

    return { service, invoices };
  };

  it('returns the existing invoice for the same key and same payload', async () => {
    const dto = createDto();
    const existingInvoice = {
      _id: new Types.ObjectId(),
      invoiceNumber: 'SR/2026-27/000001',
      requestFingerprint: fingerprint(dto),
    };

    const { service, invoices } = createService(existingInvoice);

    const result = await service.createSale(tenantId, userId, dto);

    expect(result).toBe(existingInvoice);
    expect(invoices.findOne).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of the same key with a changed payload', async () => {
    const originalDto = createDto();
    const existingInvoice = {
      _id: new Types.ObjectId(),
      invoiceNumber: 'SR/2026-27/000001',
      requestFingerprint: fingerprint(originalDto),
    };

    const changedDto = createDto();
    changedDto.items[0].quantity = 3;

    const { service, invoices } = createService(existingInvoice);

    await expect(
      service.createSale(tenantId, userId, changedDto),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(invoices.findOne).toHaveBeenCalledTimes(1);
  });
});
