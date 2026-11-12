import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';

describe('ReportsService validation', () => {
  const createService = () => {
    const invoices = { aggregate: jest.fn() };

    const service = new ReportsService(
      invoices as any,
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
    const { service, invoices } = createService();
    await expect(service.gstr1('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.gstr3b('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.hsnSummary('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.gstReconciliation('invalid-tenant', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(invoices.aggregate).not.toHaveBeenCalled();
  });

});
