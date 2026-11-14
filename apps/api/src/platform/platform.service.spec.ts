import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { gzipSync } from 'zlib';
import { PlatformService } from './platform.service';

describe('PlatformService security boundaries', () => {
  const tenantId = '507f1f77bcf86cd799439011';
  const userId = '507f1f77bcf86cd799439012';
  const createService = (allowedUsers = '') => new PlatformService(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any,
    { get: jest.fn().mockReturnValue(allowedUsers) } as any,
  );

  it('rejects invalid tenant context before querying automation rules', async () => {
    const service = createService();
    await expect(service.listAutomationRules('not-an-object-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid notification identity before querying notifications', async () => {
    const service = createService();
    await expect(service.listNotifications('bad-tenant', userId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects corrupt backup archives', async () => {
    const service = createService();
    await expect(service.verifyBackup(tenantId, { archiveBase64: Buffer.from('not-gzip').toString('base64') }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a backup archive belonging to another tenant', async () => {
    const service = createService();
    const archive = gzipSync(Buffer.from(JSON.stringify({
      format: 'SOLSTRA_RETAIL_TENANT_BACKUP_V1',
      tenantId: '507f1f77bcf86cd799439099',
      tenant: { _id: '507f1f77bcf86cd799439099' },
      collections: {},
    })));
    await expect(service.verifyBackup(tenantId, { archiveBase64: archive.toString('base64') }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies SaaS-wide access when no platform operator allowlist is configured', async () => {
    const service = createService('');
    await expect(service.listSaasTenants(userId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unlisted account from platform-wide tenant administration', async () => {
    const service = createService('507f1f77bcf86cd799439099');
    await expect(service.platformUsageSummary(userId)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
