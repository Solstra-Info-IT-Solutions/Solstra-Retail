import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';

describe('ReportsService validation', () => {
  const createService = () => {
    const invoices = { aggregate: jest.fn() };
    const products = { find: jest.fn() };
    const purchases = { find: jest.fn() };
    const journals = { find: jest.fn() };
    const gstSubmissions = { findOne: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn() };

    const service = new ReportsService(
      invoices as any,
      {} as any,
      products as any,
      {} as any,
      {} as any,
      journals as any,
      purchases as any,
      {} as any,
      { countDocuments: jest.fn() } as any,
      { countDocuments: jest.fn() } as any,
      gstSubmissions as any,
      {} as any,
    );

    return { service, invoices, products, purchases, journals, gstSubmissions };
  };

  it('exports posted balanced journals as escaped Tally XML vouchers', async () => {
    const { service, journals } = createService();
    journals.find.mockReturnValue({
      select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [{
        entryNumber: 'JV-001', postingDate: new Date('2026-10-10T00:00:00.000Z'),
        narration: 'Sale & adjustment',
        lines: [
          { accountName: 'Cash & Bank', debit: 100, credit: 0 },
          { accountName: 'Sales', debit: 0, credit: 100 },
        ],
      }] }) }) }),
    });
    const result = await service.tallyXmlExport('507f1f77bcf86cd799439011', { from: '2026-10-01', to: '2026-10-31' });
    expect(result.voucherCount).toBe(1);
    expect(result.content).toContain('<DATE>20261010</DATE>');
    expect(result.content).toContain('Cash &amp; Bank');
    expect(result.content).toContain('<AMOUNT>-100.00</AMOUNT>');
    expect(result.content).toContain('<AMOUNT>100.00</AMOUNT>');
  });

  it('rejects invalid migration export entity, cursor and tenant context', async () => {
    const { service } = createService();
    await expect(service.exportMigrationRecords('invalid-tenant', 'customers')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.exportMigrationRecords('507f1f77bcf86cd799439011', 'unknown')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.exportMigrationRecords('507f1f77bcf86cd799439011', 'customers', 'bad-cursor')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid tenant context for Tally XML and migration preflight', async () => {
    const { service, invoices } = createService();
    await expect(service.tallyXmlExport('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.migrationReadiness('invalid-tenant')).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

  it('compares this month sales with the previous complete month without enabling arbitrary query execution', async () => {
    const { service } = createService();
    const sales = jest.spyOn(service, 'salesReport')
      .mockResolvedValueOnce({ invoiceCount: 8, netSalesRupees: 1200 } as any)
      .mockResolvedValueOnce({ invoiceCount: 6, netSalesRupees: 1000 } as any);
    const result: any = await service.answerBusinessQuestion('507f1f77bcf86cd799439011', 'compare sales this month vs last month');
    expect(result.mode).toBe('RULE_BASED_COMPARATIVE_ANALYSIS');
    expect(result.change).toMatchObject({ amountRupees: 200, percent: 20, direction: 'UP' });
    expect(sales).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported demand forecast horizons before querying invoices', async () => {
    const { service, invoices } = createService();
    await expect(service.demandForecast('507f1f77bcf86cd799439011', 3)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.demandForecast('invalid-tenant', 30)).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

  it('builds a tenant-scoped weighted demand forecast with safety stock', async () => {
    const { service, invoices, products } = createService();
    invoices.aggregate.mockResolvedValue([{
      _id: '507f1f77bcf86cd799439099',
      days: [{ day: '2026-11-13', units: 20 }, { day: '2026-10-01', units: 10 }],
      totalUnits: 30,
    }]);
    products.find.mockReturnValue({
      select: () => ({ limit: () => ({ lean: async () => [{
        _id: '507f1f77bcf86cd799439099', name: 'Test product', sku: 'T-1',
        stockQty: 2, lowStockThreshold: 5,
      }] }) }),
    });
    const result = await service.demandForecast('507f1f77bcf86cd799439011', 30);
    expect(result.model).toContain('WEIGHTED_30_60_DAY');
    expect(result.forecasts).toHaveLength(1);
    const forecast: any = result.forecasts[0];
    expect(forecast.suggestedReorderQty).toBeGreaterThan(0);
    expect(invoices.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ $match: expect.objectContaining({ tenantId: expect.anything() }) }),
    ]));
  });

  it('rejects invalid GST e-invoice cancellation requests before provider calls', async () => {
    const { service } = createService();
    await expect(service.cancelGstEInvoice('invalid-tenant', 'invalid-id', 'reason')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.cancelGstEInvoice('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012', 'short')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to cancel an e-invoice without a provider-acknowledged IRN', async () => {
    const { service, gstSubmissions } = createService();
    gstSubmissions.findOne.mockReturnValue({ lean: async () => ({ status: 'FAILED', irn: '' }) });
    await expect(service.cancelGstEInvoice(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439012',
      'Duplicate invoice was issued in error',
    )).rejects.toBeInstanceOf(BadRequestException);
  });

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

  it('rejects invalid tenant context in advanced analytics before querying data', async () => {
    const { service, invoices } = createService();
    await expect(service.advancedAnalytics('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.businessAssistantInsights('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

  it('rejects invalid tenant context in GST e-invoice preflight and accounting interchange export', async () => {
    const { service, invoices } = createService();
    await expect(service.gstEinvoiceReadiness('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.accountingJournalCsvExport('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

  it('rejects invalid tenant context and oversized questions before running business assistant queries', async () => {
    const { service, invoices } = createService();
    await expect(service.answerBusinessQuestion('invalid-tenant', 'show sales')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.answerBusinessQuestion('507f1f77bcf86cd799439011', 'x'.repeat(301))).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

  it('returns supported report topics instead of executing arbitrary business queries', async () => {
    const { service, invoices } = createService();
    const result = await service.answerBusinessQuestion('507f1f77bcf86cd799439011', 'delete every customer record');
    expect(result.interpretation).toBe('Question not matched to a supported report');
    expect(result.supportedTopics).toContain('sales');
    expect(result.disclaimer).toContain('does not execute arbitrary database queries');
    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

  it('rejects invalid tenant context before historical migration assessment queries', async () => {
    const { service } = createService();
    await expect(service.migrationReadiness('invalid-tenant')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.submitGstEInvoice('invalid-tenant', 'invalid-invoice')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid tenant and unsupported GST compliance submissions before external calls', async () => {
    const { service, invoices } = createService();
    await expect(service.submitGstCompliance('invalid-tenant', 'GSTR1', '2026-10')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.submitGstCompliance('507f1f77bcf86cd799439011', 'UNKNOWN', '2026-10')).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

  it('rejects malformed and not-yet-closed GST return periods before reading source records', async () => {
    const { service, invoices } = createService();
    await expect(service.submitGstCompliance('507f1f77bcf86cd799439011', 'GSTR1', '2026-13'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.submitGstCompliance('507f1f77bcf86cd799439011', 'GSTR3B', '2999-01'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.aggregate).not.toHaveBeenCalled();
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

  it('exports a tenant-scoped purchase register as spreadsheet-safe CSV', async () => {
    const { service, purchases } = createService();
    purchases.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: async () => [{
            purchaseNumber: 'PUR-CSV-01',
            supplierInvoiceNumber: '=HYPERLINK("https://bad.example")',
            supplierInvoiceDate: new Date('2026-10-12T00:00:00.000Z'),
            purchaseDate: new Date('2026-10-12T00:00:00.000Z'),
            supplierGstinSnapshot: '27ABCDE1234F1Z5',
            supplierStateCodeSnapshot: '27',
            placeOfSupplyStateCode: '27',
            subtotal: 100,
            gstTotal: 18,
            cgstTotal: 9,
            sgstTotal: 9,
            igstTotal: 0,
            grandTotal: 118,
            gstSplitClassified: true,
          }],
        }),
      }),
    });

    const result = await service.gstCsvExport('507f1f77bcf86cd799439011', 'purchase-register', {
      from: '2026-10-01', to: '2026-10-31',
    });

    expect(result.filename).toBe('gst-inward-purchase-register.csv');
    expect(result.contentType).toBe('text/csv; charset=utf-8');
    expect(result.content.charCodeAt(0)).toBe(0xfeff);
    expect(result.content).toContain("'=HYPERLINK(");
    expect(result.content).toContain('"100"');
    expect(result.content).toContain('"0"');
    expect(result.content).toContain('\r\n');
    expect(purchases.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId: expect.anything() }));
  });

  it('rejects unsupported GST CSV export types', async () => {
    const { service, purchases } = createService();
    await expect(service.gstCsvExport('507f1f77bcf86cd799439011', 'unknown', {}))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(purchases.find).not.toHaveBeenCalled();
  });
});
