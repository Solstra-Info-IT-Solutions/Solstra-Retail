import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';

describe('ReportsService validation', () => {
  const createService = () => {
    const invoices = { aggregate: jest.fn() };
    const purchases = { find: jest.fn() };

    const service = new ReportsService(
      invoices as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      purchases as any,
      {} as any,
    );

    return { service, invoices, purchases };
  };

  it('rejects impossible calendar dates', async () => {
    const { service, invoices } = createService();

    await expect(
      service.salesReport('507f1f77bcf86cd799439011', {
        from: '2026-02-30',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

  it('rejects a date range where start is after end', async () => {
    const { service, invoices } = createService();

    await expect(
      service.salesReport('507f1f77bcf86cd799439011', {
        from: '2026-11-10',
        to: '2026-11-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

  it('rejects invalid tenant context in cash flow statement', async () => {
    const { service } = createService();

    await expect(
      service.cashFlowStatement('invalid-tenant', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid tenant context in dashboard summary', async () => {
    const { service } = createService();

    await expect(
      service.dashboardSummary('invalid-tenant'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid tenant context in GST reports before querying data', async () => {
    const { service, invoices, purchases } = createService();
    await expect(service.gstr1('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.gstr3b('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.hsnSummary('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.gstReconciliation('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.gstPurchaseRegister('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.inwardHsnSummary('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.aggregate).not.toHaveBeenCalled();
    expect(purchases.find).not.toHaveBeenCalled();
  });


  it('groups inward HSN values by HSN and GST rate using supplier invoice period filters', async () => {
    const { service, purchases } = createService();
    purchases.find.mockReturnValue({
      select: () => ({
        lean: async () => [{
          items: [
            { hsnCode: '3004', gstRate: 12, quantity: 2, taxableValue: 100, cgstAmount: 6, sgstAmount: 6, igstAmount: 0, gstAmount: 12, gstSplitClassified: true },
            { hsnCode: '3004', gstRate: 12, quantity: 1, taxableValue: 50, cgstAmount: 3, sgstAmount: 3, igstAmount: 0, gstAmount: 6, gstSplitClassified: true },
            { hsnCode: '', gstRate: 5, quantity: 1, taxableValue: 20, cgstAmount: 0, sgstAmount: 0, igstAmount: 1, gstAmount: 1, gstSplitClassified: false },
          ],
        }],
      }),
    });
    const result = await service.inwardHsnSummary('507f1f77bcf86cd799439011', {
      from: '2026-10-01', to: '2026-10-31',
    });
    expect(result.purchaseCount).toBe(1);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ hsnCode: null, gstRate: 5, taxableValue: 20, unclassifiedLineCount: 1 });
    expect(result.rows[1]).toMatchObject({ hsnCode: '3004', gstRate: 12, quantity: 3, taxableValue: 150, cgst: 9, sgst: 9, totalTax: 18 });
    expect(result.totals).toMatchObject({ taxableValue: 170, totalTax: 19, lineCount: 3 });
    const filter = purchases.find.mock.calls[0][0];
    expect(filter.$or).toEqual(expect.arrayContaining([
      { supplierInvoiceDate: { $gte: expect.any(Date), $lte: expect.any(Date) } },
      { supplierInvoiceDate: null, purchaseDate: { $gte: expect.any(Date), $lte: expect.any(Date) } },
    ]));
  });

  it('returns a purchase register with explicit legacy date fallback labels', async () => {
    const { service, purchases } = createService();
    purchases.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: async () => [{
            purchaseNumber: 'PUR-001',
            purchaseDate: new Date('2026-10-12T00:00:00.000Z'),
            supplierInvoiceDate: null,
            subtotal: 100, gstTotal: 12, grandTotal: 112,
            gstSplitClassified: false, supplierGstinSnapshot: null,
          }],
        }),
      }),
    });
    const result = await service.gstPurchaseRegister('507f1f77bcf86cd799439011', {
      from: '2026-10-01', to: '2026-10-31',
    });
    expect(result.totals).toMatchObject({ purchaseCount: 1, taxableValue: 100, gst: 12, invoiceValue: 112 });
    expect(result.purchases[0].taxDateBasis).toBe('PURCHASE_ENTRY_DATE_FALLBACK');
    expect(result.purchasesUsingEntryDateFallback).toBe(1);
    expect(result.unclassifiedPurchaseCount).toBe(1);
  });
});
