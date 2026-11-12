import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  const tenantId = new Types.ObjectId().toString();

  it('trims category name and creates normalized name', async () => {
    const categories = {
      create: jest.fn().mockResolvedValue({ name: 'Electronics' }),
    };

    const service = new CategoriesService(
      categories as any,
      {} as any,
    );

    await service.create(tenantId, {
      name: '  Electronics  ',
      description: '  Devices  ',
    });

    expect(categories.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Electronics',
        normalizedName: 'electronics',
        description: 'Devices',
        tenantId: expect.any(Types.ObjectId),
      }),
    );
  });

  it('rejects category names shorter than two characters after trimming', async () => {
    const categories = { create: jest.fn() };
    const service = new CategoriesService(categories as any, {} as any);

    await expect(
      service.create(tenantId, { name: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(categories.create).not.toHaveBeenCalled();
  });
});
