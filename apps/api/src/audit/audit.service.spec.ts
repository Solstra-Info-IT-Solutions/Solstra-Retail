import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let logs: any;

  beforeEach(() => {
    logs = { create: jest.fn().mockResolvedValue({}) };
    service = new AuditService(logs);
  });

  it('records only valid tenant and actor identities', async () => {
    await service.record({
      tenantId: 'invalid', actorId: '507f1f77bcf86cd799439011',
      actorRole: 'owner', action: 'POST', resource: 'Sales',
      route: '/api/v1/sales',
    });
    expect(logs.create).not.toHaveBeenCalled();
  });

  it('stores mutation metadata without accepting request payload fields', async () => {
    await service.record({
      tenantId: '507f1f77bcf86cd799439011',
      actorId: '507f1f77bcf86cd799439012',
      actorRole: 'admin', action: 'PATCH', resource: 'Products',
      resourceId: '507f1f77bcf86cd799439013',
      route: '/api/v1/products/:id', ipAddress: '127.0.0.1',
      userAgent: 'unit-test',
    });
    expect(logs.create).toHaveBeenCalledWith(expect.objectContaining({
      actorRole: 'admin', action: 'PATCH', resource: 'Products',
      resourceId: '507f1f77bcf86cd799439013',
      route: '/api/v1/products/:id', ipAddress: '127.0.0.1',
    }));
    expect(logs.create.mock.calls[0][0]).not.toHaveProperty('body');
    expect(logs.create.mock.calls[0][0]).not.toHaveProperty('password');
  });
});
