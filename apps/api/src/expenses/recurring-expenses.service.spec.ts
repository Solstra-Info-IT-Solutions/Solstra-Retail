import { RecurringExpensesService } from './recurring-expenses.service';

describe('RecurringExpensesService scheduled worker', () => {
  it('discovers due tenants and delegates each tenant to the idempotent schedule runner', async () => {
    const tenantId = '507f1f77bcf86cd799439011';
    const schedules: any = {
      distinct: jest.fn().mockResolvedValue([tenantId]),
      find: jest.fn(() => ({
        sort: () => ({
          select: () => ({
            limit: () => ({
              lean: async () => [{ createdBy: '507f1f77bcf86cd799439012' }],
            }),
          }),
        }),
      })),
    };
    const service = new RecurringExpensesService({} as any, schedules, {} as any);
    const runDue = jest.spyOn(service, 'runDue').mockResolvedValue({
      generatedCount: 2, generated: [], checkedCount: 2, limit: 50,
    } as any);

    const result = await service.runDueScheduledForAllTenants(new Date('2026-11-14T10:00:00.000Z'));

    expect(schedules.distinct).toHaveBeenCalledWith('tenantId', expect.objectContaining({ status: 'ACTIVE' }));
    expect(runDue).toHaveBeenCalledWith(tenantId, '507f1f77bcf86cd799439012', expect.any(Date));
    expect(result.processedTenants).toBe(1);
    expect(result.results[0].generatedCount).toBe(2);
  });
});
