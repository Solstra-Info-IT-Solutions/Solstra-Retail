import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('ProductsService migration import', () => {
  const createService = (products: any = {}) => new ProductsService(
    products as any,
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

  it('detects duplicate SKUs within one import and never imports opening stock', async () => {
    const products = { findOne: jest.fn(() => ({ select: () => ({ lean: async () => null }) })) };
    const service = createService(products);
    const tenantId = '507f1f77bcf86cd799439011';
    const row = { name: 'Imported item', sku: 'SKU-1', purchasePrice: 10, sellingPrice: 15, mrp: 18, gstRate: 5, stockQty: 900 };
    const preview = await service.previewProductImport(tenantId, [row, row]);
    expect(preview.validRows).toBe(1);
    expect(preview.invalidRows).toBe(1);
    expect(preview.rows[1].errors).toContain('SKU is duplicated within this import file');
    expect(preview.rows[0].product).not.toHaveProperty('stockQty');
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
