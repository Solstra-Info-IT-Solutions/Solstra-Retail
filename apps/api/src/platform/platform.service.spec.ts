import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { gzipSync } from 'zlib';
import { PlatformService } from './platform.service';

describe('PlatformService security boundaries', () => {
  const tenantId = '507f1f77bcf86cd799439011';
  const userId = '507f1f77bcf86cd799439012';
  const createService = (allowedUsers = '') => new PlatformService(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    { get: jest.fn().mockReturnValue(allowedUsers) } as any,
  );

  it('rejects invalid tenant context before querying automation rules', async () => {
    const service = createService();
    await expect(service.listAutomationRules('not-an-object-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid offline device identity before database access', async () => {
    const service = createService();
    await expect(service.registerOfflineDevice('bad-tenant', userId, { deviceId: 'bad', label: 'Counter PC' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.revokeOfflineDevice('bad-tenant', 'device-id'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid notification identity before querying notifications', async () => {
    const service = createService();
    await expect(service.listNotifications('bad-tenant', userId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects offline invoice sync from an unregistered or revoked device', async () => {
    const service: any = createService();
    service.offlineDevices = { findOneAndUpdate: jest.fn(() => ({ lean: async () => null })) };
    await expect(service.syncOfflineSales(tenantId, userId, {
      deviceId: 'b5f6a4c2-1d4e-4b2a-9f0c-123456789abc',
      operations: [],
    } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.offlineDevices.findOneAndUpdate).toHaveBeenCalled();
  });

  it('does not reactivate an offline device that was explicitly revoked', async () => {
    const service: any = createService();
    service.offlineDevices = { findOne: jest.fn(() => ({ lean: async () => ({ revokedAt: new Date() }) })) };
    await expect(service.registerOfflineDevice(tenantId, userId, {
      deviceId: 'b5f6a4c2-1d4e-4b2a-9f0c-123456789abc', label: 'Counter PC',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks reuse of an offline idempotency key with a different payload', async () => {
    const service: any = createService();
    service.syncRecords = {
      findOne: jest.fn(() => ({ lean: async () => ({
        _id: '507f1f77bcf86cd799439099', status: 'FAILED',
        payloadSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }) })),
    };
    const result = await service.syncOfflineSales(tenantId, userId, {
      operations: [{ type: 'SALE', idempotencyKey: 'offline-key-123', payload: { idempotencyKey: 'offline-key-123', items: [] } }],
    });
    expect(result.results[0].status).toBe('CONFLICT');
    expect(result.results[0].error).toContain('different invoice payload');
    expect(service.syncRecords.findOne).toHaveBeenCalled();
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

  it('rejects checkout creation for an invalid tenant before reading invoices', async () => {
    const service = createService();
    await expect(service.createSubscriptionCheckout('bad-tenant', userId, 'bad-invoice'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unsigned Razorpay webhook requests', async () => {
    const service = createService();
    await expect(service.handleRazorpayWebhook(Buffer.from('{}'), undefined))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unsigned communication delivery receipts', async () => {
    const service = createService();
    await expect(service.recordCommunicationReceipt('507f1f77bcf86cd799439013', Buffer.from('{}'), undefined))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('marks archive validation separately when no isolated DR target is configured', async () => {
    const service: any = createService();
    service.config = { get: jest.fn((key: string) => key === 'DR_RESTORE_MONGO_URI' ? '' : '') };
    await expect(service.restoreArchiveIntoIsolatedDatabase({ collections: {} }))
      .resolves.toMatchObject({ status: 'NOT_CONFIGURED' });
  });

  it('refuses to run a restore drill against the production MongoDB host', async () => {
    const service: any = createService();
    service.config = { get: jest.fn((key: string) => key === 'DR_RESTORE_MONGO_URI'
      ? 'mongodb://restore-user:secret@prod.example.com:27017/dr'
      : 'mongodb://app:secret@prod.example.com:27017/solstra') };
    await expect(service.restoreArchiveIntoIsolatedDatabase({ collections: {} }))
      .rejects.toThrow('separate MongoDB host');
  });

  it('never exposes provider credentials in the readiness response', async () => {
    const service: any = createService();
    service.config = { get: jest.fn((key: string) => key.startsWith('ZOHO_BOOKS_') ? 'configured-secret' : '') };
    service.communicationProviders = { countDocuments: jest.fn().mockResolvedValue(0) };
    const result = await service.integrationProviderReadiness(tenantId);
    expect(JSON.stringify(result)).not.toContain('configured-secret');
    expect(result.accounting.zohoBooks.configured).toBe(true);
    expect(result.accounting.zohoBooks.mode).toBe('OAUTH_CREDENTIALS_ONLY');
  });

  it('rejects invalid tenant context before operational metrics queries', async () => {
    const service = createService();
    await expect(service.operationsMetrics('invalid-tenant')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listBackupRestoreDrills('invalid-tenant')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid backup artifact IDs before restore drill reads', async () => {
    const service = createService();
    await expect(service.runBackupRestoreDrill(tenantId, 'invalid-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies SaaS-wide access when no platform operator allowlist is configured', async () => {
    const service = createService('');
    await expect(service.listSaasTenants(userId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unlisted account from platform-wide tenant administration', async () => {
    const service = createService('507f1f77bcf86cd799439099');
    await expect(service.platformUsageSummary(userId)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects invalid communication provider IDs before credential encryption', async () => {
    const service = createService();
    await expect(service.rotateCommunicationProviderSecret(tenantId, 'invalid-id', 'a-valid-provider-token'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a stale offline batch sequence before processing any invoice', async () => {
    const service: any = createService();
    service.offlineDevices = {
      findOneAndUpdate: jest.fn(() => ({ lean: async () => ({
        _id: '507f1f77bcf86cd799439088', lastSyncSequence: 12,
        lastSyncPayloadSha256: 'different-payload', lastSyncStatus: 'SUCCEEDED',
      }) })),
    };
    await expect(service.syncOfflineSales(tenantId, userId, {
      deviceId: 'b5f6a4c2-1d4e-4b2a-9f0c-123456789abc',
      batchSequence: 12,
      operations: [{ type: 'SALE', idempotencyKey: 'offline-key-123', payload: { idempotencyKey: 'offline-key-123' } }],
    } as any)).rejects.toThrow('Offline sync sequence is stale');
  });

  it('replays a previously acknowledged offline batch without recreating invoices', async () => {
    const service: any = createService();
    const { createHash } = require('crypto');
    const operations = [{ type: 'SALE', idempotencyKey: 'offline-key-123', payload: { idempotencyKey: 'offline-key-123' } }];
    const hash = createHash('sha256').update(JSON.stringify(operations)).digest('hex');
    service.offlineDevices = {
      findOneAndUpdate: jest.fn(() => ({ lean: async () => ({
        _id: '507f1f77bcf86cd799439088', lastSyncSequence: 13,
        lastSyncPayloadSha256: hash, lastSyncStatus: 'SUCCEEDED',
        lastSyncResult: { accepted: 1, results: [{ idempotencyKey: 'offline-key-123', status: 'SUCCEEDED' }] },
      }) })),
    };
    service.sales = { createSale: jest.fn() };
    const result = await service.syncOfflineSales(tenantId, userId, {
      deviceId: 'b5f6a4c2-1d4e-4b2a-9f0c-123456789abc', batchSequence: 13, operations,
    } as any);
    expect(result.replayed).toBe(true);
    expect(result.results[0].status).toBe('SUCCEEDED');
    expect(service.sales.createSale).not.toHaveBeenCalled();
  });

  it('records a failed offline batch as terminal and replays its result exactly', async () => {
    const service: any = createService();
    const { createHash } = require('crypto');
    const operations = [{ type: 'SALE', idempotencyKey: 'offline-key-456', payload: { idempotencyKey: 'offline-key-456' } }];
    const hash = createHash('sha256').update(JSON.stringify(operations)).digest('hex');
    const device = {
      _id: '507f1f77bcf86cd799439088', lastSyncSequence: 4,
      lastSyncPayloadSha256: hash, lastSyncStatus: 'FAILED',
      lastSyncResult: { accepted: 1, batchStatus: 'FAILED', results: [{ idempotencyKey: 'offline-key-456', status: 'FAILED' }] },
    };
    service.offlineDevices = { findOneAndUpdate: jest.fn(() => ({ lean: async () => device })) };
    service.syncRecords = { findOne: jest.fn() };
    const replay = await service.syncOfflineSales(tenantId, userId, {
      deviceId: 'b5f6a4c2-1d4e-4b2a-9f0c-123456789abc', batchSequence: 4, operations,
    } as any);
    expect(replay.batchStatus).toBe('FAILED');
    expect(replay.replayed).toBe(true);
    expect(service.syncRecords.findOne).not.toHaveBeenCalled();
  });

  it('lists offline sync history within tenant and restricts staff to their own records', async () => {
    const service: any = createService();
    const rows = [{ idempotencyKey: 'offline-key-123', status: 'FAILED', createdBy: userId }];
    const find = jest.fn((_filter: any) => ({ select: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => rows }) }) }) }) }));
    service.syncRecords = { find, countDocuments: jest.fn().mockResolvedValue(1) };
    const result = await service.listOfflineSyncRecords(tenantId, userId, 'staff', 1, 'FAILED');
    expect(result.items).toEqual(rows);
    expect(result.total).toBe(1);
    expect(find.mock.calls[0][0]).toMatchObject({ tenantId: expect.anything(), createdBy: expect.anything(), status: 'FAILED' });
  });

  it('emits an overdue subscription reminder at most once per claimed reminder window', async () => {
    const service: any = createService();
    const invoice = { _id: '507f1f77bcf86cd799439099', tenantId, invoiceNumber: 'SRS-202611-TEST', dueAt: new Date(Date.now() - 2 * 86400000) };
    service.subscriptionInvoices = {
      find: jest.fn()
        .mockImplementationOnce(() => ({ select: () => ({ lean: async () => [invoice] }) }))
        .mockImplementationOnce(() => ({ limit: () => ({ lean: async () => [invoice] }) })),
      findOneAndUpdate: jest.fn().mockReturnValue({ lean: async () => ({ reminderCount: 1 }) }),
    };
    service.tenants = { updateOne: jest.fn() };
    service.runScheduledBackupJobs = jest.fn().mockResolvedValue({ processed: 0 });
    service.deliveries = { distinct: jest.fn().mockResolvedValue([]) };
    service.communicationDeliveries = { distinct: jest.fn().mockResolvedValue([]) };
    service.backupReplicationEvents = { aggregate: jest.fn().mockResolvedValue([]) };
    const notify = jest.spyOn(service, 'createNotification').mockResolvedValue({} as any);
    const result = await service.runScheduledPlatformJobs();
    expect(result.billingReminders).toBe(1);
    expect(service.subscriptionInvoices.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(tenantId, expect.objectContaining({ category: 'BILLING', severity: 'WARNING' }));
  });

});
