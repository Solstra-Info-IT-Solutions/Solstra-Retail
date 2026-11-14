import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('ProductsService migration import', () => {
  const createService = () => new ProductsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  it('rejects invalid tenant context before checking imported rows', async () => {
    const service = createService();
    await expect(service.previewProductImport('invalid-tenant', [{ name: 'Sample' }]))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty and oversized product import batches', async () => {
    const service = createService();
    const tenantId = '507f1f77bcf86cd799439011';
    await expect(service.previewProductImport(tenantId, []))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.previewProductImport(tenantId, Array.from({ length: 201 }, () => ({}))))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
