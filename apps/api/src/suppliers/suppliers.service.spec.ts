import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  const tenantId = new Types.ObjectId().toString();

  it('normalizes supplier contact details during creation', async () => {
    const suppliers = {
      create: jest.fn().mockResolvedValue({ name: 'Supplier' }),
    };

    const service = new SuppliersService(suppliers as any);

    await service.create(tenantId, {
      name: 'Supplier',
      phone: ' 9876543210 ',
      email: ' TEST@EXAMPLE.COM ',
      gstin: ' 09ABCDE1234F1Z5 ',
    } as any);

    expect(suppliers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '9876543210',
        email: 'test@example.com',
        gstin: '09ABCDE1234F1Z5',
        tenantId: expect.any(Types.ObjectId),
      }),
    );
  });

  it('rejects invalid tenant IDs', async () => {
    const suppliers = { create: jest.fn() };
    const service = new SuppliersService(suppliers as any);

    await expect(
      service.create('invalid-tenant', { name: 'Supplier' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(suppliers.create).not.toHaveBeenCalled();
  });
});
