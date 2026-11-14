import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, ServiceUnavailableException, OnModuleInit, OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { GridFSBucket } from 'mongodb';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { tenantFilter } from '../common/tenant-scoped.service';
import { SalesService } from '../sales/sales.service';
import { CreateSaleDto } from '../sales/dto/create-sale.dto';
import { Tenant } from '../tenants/schemas/tenant.schema';
import { User } from '../auth/schemas/user.schema';
import { Product } from '../products/schemas/product.schema';
import { WarehouseStock } from '../inventory/schemas/warehouse-stock.schema';
import {
  AutomationExecution, AutomationRule, BackupArtifact, BackupPolicy, BackupRestoreDrill, OfflineDevice, OfflineSyncRecord, PlatformNotification, SaasAdminAudit,
  WebhookDelivery, WebhookIntegration, CommunicationProvider, CommunicationDelivery, SubscriptionInvoice, BackupReplicationEvent,
} from './schemas/platform.schema';
import {
  BackupPolicyDto, CreateAutomationRuleDto, CreateWebhookDto, OfflineSyncBatchDto,
  TriggerAutomationDto, UpdateAutomationRuleDto, UpdateSaasTenantDto,
  UpdateWebhookDto, VerifyBackupDto, RegisterOfflineDeviceDto, CreateCommunicationProviderDto, SendCommunicationDto, RecordSubscriptionPaymentDto,
} from './dto/platform.dto';

const EVENT_TYPES = ['MANUAL', 'SALE_CREATED', 'LOW_STOCK', 'EXPENSE_PENDING_APPROVAL'];
const MAX_BACKUP_DOCUMENTS = 100000;
const EXCLUDED_BACKUP_COLLECTIONS = new Set([
  'automation_rules', 'platform_notifications', 'webhook_integrations',
  'webhook_deliveries', 'offline_sync_records', 'backup_policies', 'backup_artifacts',
]);

@Injectable()
export class PlatformService implements OnModuleInit, OnModuleDestroy {
  private backupTimer?: NodeJS.Timeout;

  onModuleInit() {
    this.backupTimer = setInterval(() => { void this.runScheduledPlatformJobs().catch(() => undefined); }, 60_000);
    void this.runScheduledPlatformJobs().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.backupTimer) clearInterval(this.backupTimer);
  }
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(AutomationRule.name) private readonly rules: Model<any>,
    @InjectModel(AutomationExecution.name) private readonly executions: Model<any>,
    @InjectModel(PlatformNotification.name) private readonly notifications: Model<any>,
    @InjectModel(WebhookIntegration.name) private readonly integrations: Model<any>,
    @InjectModel(WebhookDelivery.name) private readonly deliveries: Model<any>,
    @InjectModel(OfflineSyncRecord.name) private readonly syncRecords: Model<any>,
    @InjectModel(OfflineDevice.name) private readonly offlineDevices: Model<any>,
    @InjectModel(BackupPolicy.name) private readonly backupPolicies: Model<any>,
    @InjectModel(BackupArtifact.name) private readonly backupArtifacts: Model<any>,
    @InjectModel(SaasAdminAudit.name) private readonly saasAudit: Model<any>,
    @InjectModel(Tenant.name) private readonly tenants: Model<any>,
    @InjectModel(User.name) private readonly users: Model<any>,
    @InjectModel(Product.name) private readonly products: Model<any>,
    @InjectModel(WarehouseStock.name) private readonly warehouseStocks: Model<any>,
    @InjectModel(CommunicationProvider.name) private readonly communicationProviders: Model<any>,
    @InjectModel(CommunicationDelivery.name) private readonly communicationDeliveries: Model<any>,
    @InjectModel(SubscriptionInvoice.name) private readonly subscriptionInvoices: Model<any>,
    @InjectModel(BackupReplicationEvent.name) private readonly backupReplicationEvents: Model<any>,
    @InjectModel(BackupRestoreDrill.name) private readonly backupRestoreDrills: Model<any>,
    private readonly sales: SalesService,
    private readonly config: ConfigService,
  ) {}

  private identity(tenantId: string, userId?: string) {
    if (!Types.ObjectId.isValid(tenantId) || (userId && !Types.ObjectId.isValid(userId))) {
      throw new BadRequestException('Invalid authenticated workspace context');
    }
  }

  private async encryptionKey() {
    const raw = this.config.get<string>('WEBHOOK_SECRET_ENCRYPTION_KEY') || '';
    if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
      throw new ServiceUnavailableException('Webhook encryption is not configured. Set WEBHOOK_SECRET_ENCRYPTION_KEY to a 32-byte hex key.');
    }
    return Buffer.from(raw, 'hex');
  }

  private encryptSecret(secret: string, key: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return { encryptedSecret: encrypted.toString('base64'), secretIv: iv.toString('base64'), secretTag: cipher.getAuthTag().toString('base64') };
  }

  private decryptSecret(row: any, key: Buffer) {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.secretIv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.secretTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.encryptedSecret, 'base64')), decipher.final()]).toString('utf8');
  }

  async createAutomationRule(tenantId: string, userId: string, dto: CreateAutomationRuleDto) {
    this.identity(tenantId, userId);
    if (!EVENT_TYPES.includes(dto.eventType)) throw new BadRequestException('Unsupported automation event');
    if (dto.actionType === 'WEBHOOK') {
      const integrationId = String(dto.config?.integrationId || '');
      if (!Types.ObjectId.isValid(integrationId)) throw new BadRequestException('Select a valid webhook integration for this action');
      const integration: any = await this.integrations.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(integrationId), enabled: true })).lean();
      if (!integration || !integration.events.includes(dto.eventType)) throw new BadRequestException('Webhook must be enabled and subscribed to this automation event');
    }
    if (dto.actionType === 'NOTIFY' && !String(dto.config?.title || '').trim()) throw new BadRequestException('Notification title is required');
    const row = await this.rules.create({
      tenantId: new Types.ObjectId(tenantId), name: dto.name.trim(), eventType: dto.eventType,
      actionType: dto.actionType, config: dto.config || {}, enabled: true, createdBy: new Types.ObjectId(userId),
    });
    return row.toObject();
  }

  async listAutomationRules(tenantId: string) {
    this.identity(tenantId);
    return this.rules.find(tenantFilter(tenantId, {})).sort({ createdAt: -1 }).lean();
  }

  async updateAutomationRule(tenantId: string, id: string, dto: UpdateAutomationRuleDto) {
    this.identity(tenantId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid automation rule ID');
    const row = await this.rules.findOneAndUpdate(tenantFilter(tenantId, { _id: new Types.ObjectId(id) }), { $set: { enabled: dto.enabled } }, { new: true, runValidators: true }).lean();
    if (!row) throw new NotFoundException('Automation rule not found');
    return row;
  }

  async triggerAutomation(tenantId: string, userId: string, dto: TriggerAutomationDto) {
    this.identity(tenantId, userId);
    if (!EVENT_TYPES.includes(dto.eventType)) throw new BadRequestException('Unsupported automation event');
    const result = await this.executeEvent(tenantId, dto.eventType, dto.eventKey, dto.payload || {});
    await this.queueEventForIntegrations(tenantId, dto.eventType, dto.eventKey, dto.payload || {});
    return result;
  }

  async executeEvent(tenantId: string, eventType: string, eventKey: string, payload: Record<string, any>) {
    this.identity(tenantId);
    const rules = await this.rules.find(tenantFilter(tenantId, { eventType, enabled: true })).lean();
    const results: Array<{ ruleId: string; status: string }> = [];
    for (const rule of rules) {
      let execution: any;
      try {
        execution = await this.executions.findOne(tenantFilter(tenantId, { ruleId: rule._id, eventKey })).lean();
        if (execution?.status === 'SUCCEEDED') {
          results.push({ ruleId: String(rule._id), status: 'SKIPPED_DUPLICATE' });
          continue;
        }
        if (execution?.status === 'PROCESSING' && new Date(execution.executedAt).getTime() > Date.now() - 5 * 60 * 1000) {
          results.push({ ruleId: String(rule._id), status: 'SKIPPED_IN_PROGRESS' });
          continue;
        }
        if (execution?.status === 'FAILED') {
          await this.executions.updateOne(tenantFilter(tenantId, { _id: execution._id, status: 'FAILED' }), { $set: { status: 'PROCESSING', errorMessage: '', executedAt: new Date() } });
        } else if (execution?.status === 'PROCESSING') {
          const recovered = await this.executions.updateOne(tenantFilter(tenantId, { _id: execution._id, status: 'PROCESSING', executedAt: execution.executedAt }), { $set: { status: 'PROCESSING', errorMessage: '', executedAt: new Date() } });
          if (!recovered.matchedCount) { results.push({ ruleId: String(rule._id), status: 'SKIPPED_IN_PROGRESS' }); continue; }
        } else {
          try {
            [execution] = await this.executions.create([{
              tenantId: new Types.ObjectId(tenantId), ruleId: rule._id, eventKey, status: 'PROCESSING',
            }]);
          } catch (error: any) {
            if (error?.code === 11000) { results.push({ ruleId: String(rule._id), status: 'SKIPPED_DUPLICATE' }); continue; }
            throw error;
          }
        }
        if (rule.actionType === 'NOTIFY') {
          await this.createNotification(tenantId, {
            title: String(rule.config?.title || rule.name).slice(0, 120),
            body: String(rule.config?.body || `Automation “${rule.name}” was triggered by ${eventType.replace(/_/g, ' ').toLowerCase()}.`).slice(0, 2000),
            severity: ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL'].includes(rule.config?.severity) ? rule.config.severity : 'INFO',
            category: 'AUTOMATION', sourceId: eventKey,
          });
          results.push({ ruleId: String(rule._id), status: 'NOTIFIED' });
        } else if (rule.actionType === 'WEBHOOK') {
          await this.queueWebhookEvent(tenantId, String(rule.config.integrationId), eventType, eventKey, payload);
          results.push({ ruleId: String(rule._id), status: 'QUEUED' });
        }
        await this.executions.updateOne(tenantFilter(tenantId, { _id: execution._id }), { $set: { status: 'SUCCEEDED', errorMessage: '', executedAt: new Date() } });
        await this.rules.updateOne(tenantFilter(tenantId, { _id: rule._id }), { $inc: { triggerCount: 1 }, $set: { lastTriggeredAt: new Date() } });
      } catch (error: any) {
        if (execution?._id) await this.executions.updateOne(tenantFilter(tenantId, { _id: execution._id }), { $set: { status: 'FAILED', errorMessage: String(error?.message || 'Automation action failed').slice(0, 500) } });
        results.push({ ruleId: String(rule._id), status: 'FAILED' });
      }
    }
    return { eventType, eventKey, matchedRules: rules.length, results };
  }

  async evaluateLowStock(tenantId: string, productIds: string[], eventKey: string) {
    this.identity(tenantId);
    const ids = [...new Set(productIds.filter(id => Types.ObjectId.isValid(id)))].map(id => new Types.ObjectId(id));
    if (!ids.length) return { triggered: 0 };
    const products = await this.products.find(tenantFilter(tenantId, {
      _id: { $in: ids }, isDeleted: false, trackStock: true,
      $expr: { $lte: ['$stockQty', '$lowStockThreshold'] },
    })).select('name sku stockQty lowStockThreshold').lean();
    for (const product of products) {
      const key = `${eventKey}:LOW_STOCK:${String(product._id)}`.slice(0, 160);
      const payload = { productId: String(product._id), name: product.name, sku: product.sku, stockQty: product.stockQty, lowStockThreshold: product.lowStockThreshold };
      await this.executeEvent(tenantId, 'LOW_STOCK', key, payload);
      await this.queueEventForIntegrations(tenantId, 'LOW_STOCK', key, payload);
    }
    return { triggered: products.length };
  }

  async createNotification(tenantId: string, input: { userId?: string; title: string; body: string; severity?: string; category: string; sourceId?: string }) {
    this.identity(tenantId, input.userId);
    const recipients = input.userId
      ? [{ _id: new Types.ObjectId(input.userId) }]
      : await this.users.find(tenantFilter(tenantId, { isActive: true })).select('_id').lean();
    if (!recipients.length) return { created: 0 };
    let created = 0;
    for (const recipient of recipients) {
      const document = {
        tenantId: new Types.ObjectId(tenantId), userId: recipient._id,
        title: input.title, body: input.body,
        severity: input.severity || 'INFO', category: input.category, sourceId: input.sourceId || '',
      };
      if (input.sourceId) {
        try {
          const result = await this.notifications.updateOne(
            tenantFilter(tenantId, { userId: recipient._id, title: input.title, category: input.category, sourceId: input.sourceId }),
            { $setOnInsert: document }, { upsert: true },
          );
          if (result.upsertedCount) created += 1;
        } catch (error: any) { if (error?.code !== 11000) throw error; }
      } else {
        await this.notifications.create(document);
        created += 1;
      }
    }
    return { created };
  }

  async listNotifications(tenantId: string, userId: string, unreadOnly = false, page = 1) {
    this.identity(tenantId, userId);
    const filter: Record<string, any> = { userId: new Types.ObjectId(userId) };
    if (unreadOnly) filter.readAt = null;
    const safePage = Math.max(1, Math.floor(page) || 1);
    const [items, unreadCount, total] = await Promise.all([
      this.notifications.find(tenantFilter(tenantId, filter)).sort({ createdAt: -1 }).skip((safePage - 1) * 30).limit(30).lean(),
      this.notifications.countDocuments(tenantFilter(tenantId, { ...filter, readAt: null })),
      this.notifications.countDocuments(tenantFilter(tenantId, filter)),
    ]);
    return { items, unreadCount, pagination: { page: safePage, limit: 30, total, totalPages: Math.ceil(total / 30) } };
  }

  async markNotificationRead(tenantId: string, userId: string, id: string) {
    this.identity(tenantId, userId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid notification ID');
    const row = await this.notifications.findOneAndUpdate(
      tenantFilter(tenantId, { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }),
      { $set: { readAt: new Date() } }, { new: true },
    ).lean();
    if (!row) throw new NotFoundException('Notification not found');
    return row;
  }

  private async validateWebhookUrl(endpointUrl: string) {
    let url: URL;
    try { url = new URL(endpointUrl); } catch { throw new BadRequestException('Invalid webhook URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new BadRequestException('Webhook endpoint must be a public HTTPS URL on port 443');
    const host = url.hostname.toLowerCase();
    if (['localhost', 'localhost.localdomain'].includes(host) || host.endsWith('.local') || host.endsWith('.internal')) throw new BadRequestException('Private webhook hosts are not allowed');
    const rejectIp = (address: string) => {
      if (address.includes(':')) return address === '::1' || address.toLowerCase().startsWith('fc') || address.toLowerCase().startsWith('fd') || address.toLowerCase().startsWith('fe80:');
      const parts = address.split('.').map(Number);
      return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
    };
    if (isIP(host)) { if (rejectIp(host)) throw new BadRequestException('Private webhook IP addresses are not allowed'); return; }
    let addresses: Array<{ address: string }>;
    try { addresses = await lookup(host, { all: true }); } catch { throw new BadRequestException('Webhook host could not be resolved'); }
    if (!addresses.length || addresses.some(item => rejectIp(item.address))) throw new BadRequestException('Webhook host resolves to a private or non-routable address');
  }

  async createWebhook(tenantId: string, dto: CreateWebhookDto) {
    this.identity(tenantId);
    await this.validateWebhookUrl(dto.endpointUrl);
    const key = await this.encryptionKey();
    const secret = randomBytes(32).toString('base64url');
    const encrypted = this.encryptSecret(secret, key);
    const row = await this.integrations.create({
      tenantId: new Types.ObjectId(tenantId), name: dto.name.trim(), endpointUrl: dto.endpointUrl,
      events: [...new Set(dto.events)], ...encrypted, enabled: true,
    });
    return { integration: { _id: row._id, name: row.name, endpointUrl: row.endpointUrl, events: row.events, enabled: row.enabled }, secret };
  }

  async listWebhooks(tenantId: string) {
    this.identity(tenantId);
    return this.integrations.find(tenantFilter(tenantId, {})).select('-encryptedSecret -secretIv -secretTag').sort({ createdAt: -1 }).lean();
  }

  async rotateWebhookSecret(tenantId: string, id: string) {
    this.identity(tenantId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid integration ID');
    const key = await this.encryptionKey();
    const secret = randomBytes(32).toString('base64url');
    const encrypted = this.encryptSecret(secret, key);
    const row = await this.integrations.findOneAndUpdate(
      tenantFilter(tenantId, { _id: new Types.ObjectId(id) }),
      { $set: encrypted }, { new: true },
    ).select('-encryptedSecret -secretIv -secretTag').lean();
    if (!row) throw new NotFoundException('Integration not found');
    return { integration: row, secret, warning: 'The previous signing secret is invalid immediately. Update the receiving endpoint before sending new deliveries.' };
  }

  async listWebhookDeliveries(tenantId: string, integrationId?: string, page = 1) {
    this.identity(tenantId);
    const safePage = Number.isInteger(page) && page > 0 ? Math.min(page, 10000) : 1;
    const query: Record<string, any> = {};
    if (integrationId) {
      if (!Types.ObjectId.isValid(integrationId)) throw new BadRequestException('Invalid integration ID');
      query.integrationId = new Types.ObjectId(integrationId);
    }
    const filter = tenantFilter(tenantId, query);
    const [items, total, counts] = await Promise.all([
      this.deliveries.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * 25).limit(25)
        .select('-payload').populate('integrationId', 'name endpointUrl').lean(),
      this.deliveries.countDocuments(filter),
      this.deliveries.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    return { items, counts: Object.fromEntries(counts.map((row: any) => [row._id, row.count])), pagination: { page: safePage, limit: 25, total, totalPages: Math.ceil(total / 25) } };
  }

  async retryWebhookDelivery(tenantId: string, id: string) {
    this.identity(tenantId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid delivery ID');
    const row: any = await this.deliveries.findOneAndUpdate(
      tenantFilter(tenantId, { _id: new Types.ObjectId(id), status: { $in: ['FAILED', 'DEAD'] } }),
      { $set: { status: 'PENDING', attempts: 0, lastError: '', nextAttemptAt: new Date() } },
      { new: true },
    ).select('-payload').lean();
    if (!row) throw new ConflictException('Only failed or dead-letter deliveries can be manually retried');
    return { id: String(row._id), status: row.status, queuedAt: row.nextAttemptAt };
  }

  async updateWebhook(tenantId: string, id: string, dto: UpdateWebhookDto) {
    this.identity(tenantId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid integration ID');
    const row = await this.integrations.findOneAndUpdate(tenantFilter(tenantId, { _id: new Types.ObjectId(id) }), { $set: { enabled: dto.enabled } }, { new: true }).select('-encryptedSecret -secretIv -secretTag').lean();
    if (!row) throw new NotFoundException('Integration not found');
    return row;
  }

  private async queueWebhookEvent(tenantId: string, integrationId: string, eventType: string, eventKey: string, payload: Record<string, any>) {
    if (!Types.ObjectId.isValid(integrationId)) throw new BadRequestException('Invalid webhook integration ID');
    const integration: any = await this.integrations.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(integrationId), enabled: true })).lean();
    if (!integration) throw new NotFoundException('Enabled webhook integration not found');
    if (!integration.events.includes(eventType)) throw new ConflictException('Webhook is not subscribed to this event');
    try {
      await this.deliveries.create({ tenantId: new Types.ObjectId(tenantId), integrationId: integration._id, eventType, eventKey, payload, status: 'PENDING', attempts: 0, nextAttemptAt: new Date() });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }

  async queueEventForIntegrations(tenantId: string, eventType: string, eventKey: string, payload: Record<string, any>) {
    this.identity(tenantId);
    const integrations = await this.integrations.find(tenantFilter(tenantId, { enabled: true, events: eventType })).select('_id').lean();
    for (const item of integrations) await this.queueWebhookEvent(tenantId, String(item._id), eventType, eventKey, payload);
    return { queued: integrations.length };
  }

  async runWebhookDeliveries(tenantId: string, limit = 20) {
    this.identity(tenantId);
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit) || 20));
    const staleDeliveryCutoff = new Date(Date.now() - 5 * 60 * 1000);
    await this.deliveries.updateMany(tenantFilter(tenantId, { status: 'DELIVERING', updatedAt: { $lte: staleDeliveryCutoff } }), { $set: { status: 'PENDING', nextAttemptAt: new Date() } });
    const due = await this.deliveries.find(tenantFilter(tenantId, { status: 'PENDING', nextAttemptAt: { $lte: new Date() } })).sort({ nextAttemptAt: 1 }).limit(safeLimit).lean();
    const results: Array<{ id: string; status: string; error?: string }> = [];
    const key = await this.encryptionKey();
    for (const delivery of due) {
      const locked = await this.deliveries.findOneAndUpdate(tenantFilter(tenantId, { _id: delivery._id, status: 'PENDING' }), { $set: { status: 'DELIVERING' } }, { new: true });
      if (!locked) continue;
      try {
        const integration: any = await this.integrations.findOne(tenantFilter(tenantId, { _id: delivery.integrationId, enabled: true })).select('+encryptedSecret +secretIv +secretTag').lean();
        if (!integration) throw new Error('Integration disabled or removed');
        await this.validateWebhookUrl(integration.endpointUrl);
        const secret = this.decryptSecret(integration, key);
        const body = JSON.stringify({ id: String(delivery._id), event: delivery.eventType, occurredAt: new Date().toISOString(), data: delivery.payload });
        const signature = createHmac('sha256', secret).update(body).digest('hex');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let response: Response;
        try {
          response = await fetch(integration.endpointUrl, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-solstra-event': delivery.eventType, 'x-solstra-signature': `sha256=${signature}`, 'x-solstra-delivery': String(delivery._id) }, body });
        } finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error(`Webhook responded with HTTP ${response.status}`);
        await this.deliveries.updateOne(tenantFilter(tenantId, { _id: delivery._id }), { $set: { status: 'DELIVERED', lastError: '' }, $inc: { attempts: 1 } });
        await this.integrations.updateOne(tenantFilter(tenantId, { _id: integration._id }), { $set: { lastDeliveredAt: new Date() } });
        results.push({ id: String(delivery._id), status: 'DELIVERED' });
      } catch (error: any) {
        const attempts = Number(delivery.attempts || 0) + 1;
        const dead = attempts >= 5;
        const delayMinutes = Math.min(60, 2 ** attempts);
        await this.deliveries.updateOne(tenantFilter(tenantId, { _id: delivery._id }), { $set: { status: dead ? 'DEAD' : 'PENDING', attempts, lastError: String(error?.message || 'Delivery failed').slice(0, 500), nextAttemptAt: new Date(Date.now() + delayMinutes * 60000) } });
        results.push({ id: String(delivery._id), status: dead ? 'DEAD' : 'RETRY_SCHEDULED', error: String(error?.message || 'Delivery failed').slice(0, 300) });
      }
    }
    return { processed: results.length, results };
  }

  async registerOfflineDevice(tenantId: string, userId: string, dto: RegisterOfflineDeviceDto) {
    this.identity(tenantId, userId);
    const filter = tenantFilter(tenantId, { userId: new Types.ObjectId(userId), deviceId: dto.deviceId });
    const existing: any = await this.offlineDevices.findOne(filter).lean();
    if (existing?.revokedAt) throw new ForbiddenException('This device was revoked. Clear its local device registration and enroll it as a new device.');
    let row: any;
    if (existing) {
      row = await this.offlineDevices.findOneAndUpdate(filter, { $set: { label: dto.label.trim(), lastSeenAt: new Date() } }, { new: true, runValidators: true }).lean();
    } else {
      try {
        row = await this.offlineDevices.create({ tenantId: new Types.ObjectId(tenantId), userId: new Types.ObjectId(userId), deviceId: dto.deviceId, label: dto.label.trim(), lastSeenAt: new Date() });
      } catch (error: any) {
        if (error?.code === 11000) throw new ConflictException('Device enrollment raced with another request; retry');
        throw error;
      }
    }
    return { deviceId: row.deviceId, label: row.label, lastSeenAt: row.lastSeenAt, revokedAt: row.revokedAt };
  }

  async listOfflineDevices(tenantId: string, userId: string) {
    this.identity(tenantId, userId);
    return this.offlineDevices.find(tenantFilter(tenantId, { userId: new Types.ObjectId(userId) }))
      .select('deviceId label lastSeenAt revokedAt createdAt').sort({ lastSeenAt: -1 }).lean();
  }

  async revokeOfflineDevice(tenantId: string, deviceId: string) {
    this.identity(tenantId);
    const row: any = await this.offlineDevices.findOneAndUpdate(
      tenantFilter(tenantId, { deviceId, revokedAt: null }),
      { $set: { revokedAt: new Date() } }, { new: true },
    ).select('deviceId label revokedAt').lean();
    if (!row) throw new NotFoundException('Active offline device not found in this workspace');
    return { deviceId: row.deviceId, label: row.label, revokedAt: row.revokedAt, status: 'REVOKED' };
  }

  async syncOfflineSales(tenantId: string, userId: string, dto: OfflineSyncBatchDto) {
    this.identity(tenantId, userId);
    let syncDevice: any = null;
    let batchPayloadSha256 = '';
    if (dto.deviceId) {
      syncDevice = await this.offlineDevices.findOneAndUpdate(
        tenantFilter(tenantId, { userId: new Types.ObjectId(userId), deviceId: dto.deviceId, revokedAt: null }),
        { $set: { lastSeenAt: new Date() } }, { new: true },
      ).lean();
      if (!syncDevice) throw new ForbiddenException('This offline device is not registered or has been revoked. Register the device again before syncing invoices.');
    }
    if (syncDevice && dto.batchSequence !== undefined) {
      batchPayloadSha256 = createHash('sha256').update(JSON.stringify(dto.operations)).digest('hex');
      const currentSequence = Number(syncDevice.lastSyncSequence || 0);
      if (syncDevice.lastSyncStatus === 'PROCESSING' && syncDevice.lastSyncStartedAt
        && new Date(syncDevice.lastSyncStartedAt).getTime() > Date.now() - 5 * 60 * 1000) {
        throw new ConflictException('Another offline batch is still processing for this device. Retry after it is acknowledged.');
      }
      if (dto.batchSequence <= currentSequence) {
        if (dto.batchSequence === currentSequence && syncDevice.lastSyncPayloadSha256 === batchPayloadSha256) {
          if (syncDevice.lastSyncStatus === 'SUCCEEDED' && syncDevice.lastSyncResult) {
            return { accepted: dto.operations.length, batchSequence: dto.batchSequence, replayed: true, ...syncDevice.lastSyncResult };
          }
          return { accepted: dto.operations.length, batchSequence: dto.batchSequence, replayed: true, results: [], batchStatus: 'PROCESSING' };
        }
        throw new ConflictException('Offline sync sequence is stale or was already used by a different batch. Refresh device sync state before retrying.');
      }
      const claim: any = await this.offlineDevices.updateOne(
        tenantFilter(tenantId, {
          _id: syncDevice._id, revokedAt: null,
          $or: [{ lastSyncSequence: currentSequence }, ...(currentSequence === 0 ? [{ lastSyncSequence: { $exists: false } }] : [])],
        }),
        { $set: { lastSyncSequence: dto.batchSequence, lastSyncPayloadSha256: batchPayloadSha256, lastSyncStatus: 'PROCESSING', lastSyncStartedAt: new Date(), lastSyncResult: null } },
      );
      if (!claim.modifiedCount) throw new ConflictException('Another sync batch advanced this device. Retry with a fresh batch sequence.');
    }
    const results: any[] = [];
    for (const operation of dto.operations) {
      const payloadSha256 = createHash('sha256').update(JSON.stringify(operation.payload)).digest('hex');
      const existing: any = await this.syncRecords.findOne(tenantFilter(tenantId, { idempotencyKey: operation.idempotencyKey })).lean();
      if (existing?.payloadSha256 && existing.payloadSha256 !== payloadSha256) {
        results.push({ idempotencyKey: operation.idempotencyKey, status: 'CONFLICT', error: 'This idempotency key is already bound to a different invoice payload. Keep the original payload or create a new invoice key.' });
        continue;
      }
      if (existing?.status === 'SUCCEEDED') { results.push({ idempotencyKey: operation.idempotencyKey, status: 'SUCCEEDED', result: existing.result, replayed: true }); continue; }
      if (existing?.status === 'PROCESSING' && new Date(existing.updatedAt || existing.createdAt).getTime() > Date.now() - 5 * 60 * 1000) { results.push({ idempotencyKey: operation.idempotencyKey, status: 'PROCESSING', replayed: true }); continue; }
      if (existing?.status === 'PROCESSING') {
        const recovered = await this.syncRecords.findOneAndUpdate(tenantFilter(tenantId, { _id: existing._id, status: 'PROCESSING', updatedAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) } }), { $set: { status: 'PROCESSING', payloadSha256, errorMessage: '' } }, { new: true }).lean();
        if (!recovered) { results.push({ idempotencyKey: operation.idempotencyKey, status: 'PROCESSING', replayed: true }); continue; }
      }
      if (!existing) {
        try {
          await this.syncRecords.create({ tenantId: new Types.ObjectId(tenantId), idempotencyKey: operation.idempotencyKey, payloadSha256, status: 'PROCESSING', createdBy: new Types.ObjectId(userId), deviceId: dto.deviceId || '', batchSequence: dto.batchSequence ?? null });
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          results.push({ idempotencyKey: operation.idempotencyKey, status: 'PROCESSING', replayed: true }); continue;
        }
      } else {
        await this.syncRecords.updateOne(tenantFilter(tenantId, { _id: existing._id, status: 'FAILED' }), { $set: { status: 'PROCESSING', payloadSha256, errorMessage: '', deviceId: dto.deviceId || '', batchSequence: dto.batchSequence ?? null } });
      }
      try {
        const payload = plainToInstance(CreateSaleDto, operation.payload);
        if (payload.idempotencyKey !== operation.idempotencyKey) throw new BadRequestException('Sale idempotencyKey must match the offline operation key');
        const errors = await validate(payload, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length) throw new BadRequestException('Offline sale payload failed validation');
        const sale = await this.sales.createSale(tenantId, userId, payload);
        const invoiceId = sale?._id || sale?.invoice?._id || sale?.data?._id;
        const summary = { invoiceId: invoiceId ? String(invoiceId) : null, invoiceNumber: sale?.invoiceNumber || sale?.invoice?.invoiceNumber || null, grandTotal: sale?.grandTotal ?? sale?.invoice?.grandTotal ?? null };
        await this.syncRecords.updateOne(tenantFilter(tenantId, { idempotencyKey: operation.idempotencyKey }), { $set: { status: 'SUCCEEDED', invoiceId: invoiceId && Types.ObjectId.isValid(String(invoiceId)) ? new Types.ObjectId(String(invoiceId)) : null, result: summary, errorMessage: '' } });
        await this.executeEvent(tenantId, 'SALE_CREATED', operation.idempotencyKey, summary);
        await this.queueEventForIntegrations(tenantId, 'SALE_CREATED', operation.idempotencyKey, summary);
        await this.evaluateLowStock(tenantId, (operation.payload.items || []).map((item: any) => String(item.productId)), operation.idempotencyKey);
        results.push({ idempotencyKey: operation.idempotencyKey, status: 'SUCCEEDED', result: summary, replayed: false });
      } catch (error: any) {
        const message = String(error?.response?.message || error?.message || 'Sale sync failed').slice(0, 500);
        await this.syncRecords.updateOne(tenantFilter(tenantId, { idempotencyKey: operation.idempotencyKey }), { $set: { status: 'FAILED', errorMessage: message } });
        results.push({ idempotencyKey: operation.idempotencyKey, status: 'FAILED', error: message });
      }
    }
    const response = { accepted: dto.operations.length, results };
    if (syncDevice && dto.batchSequence !== undefined) {
      await this.offlineDevices.updateOne(
        tenantFilter(tenantId, { _id: syncDevice._id, lastSyncSequence: dto.batchSequence, lastSyncPayloadSha256: batchPayloadSha256 }),
        { $set: { lastSyncStatus: 'SUCCEEDED', lastSyncResult: response, lastSyncAcknowledgedAt: new Date(), lastSeenAt: new Date() } },
      );
      return { ...response, batchSequence: dto.batchSequence, replayed: false };
    }
    return response;
  }

  async getBackupPolicy(tenantId: string) {
    this.identity(tenantId);
    return await this.backupPolicies.findOne(tenantFilter(tenantId, {})).lean() || { enabled: false, frequency: 'DAILY', retentionDays: 30, lastStatus: 'NOT_CONFIGURED' };
  }

  async updateBackupPolicy(tenantId: string, dto: BackupPolicyDto) {
    this.identity(tenantId);
    const nextRunAt = dto.enabled ? this.nextBackupDate(dto.frequency) : null;
    return this.backupPolicies.findOneAndUpdate(tenantFilter(tenantId, {}), { $set: { ...dto, nextRunAt } }, { new: true, upsert: true, runValidators: true }).lean();
  }

  private nextBackupDate(frequency: string) {
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + (frequency === 'WEEKLY' ? 7 : 1));
    next.setUTCHours(2, 0, 0, 0);
    return next;
  }

  async exportTenantBackup(tenantId: string) {
    this.identity(tenantId);
    const db = this.connection.db;
    if (!db) throw new ServiceUnavailableException('Database connection is unavailable');
    const tenant = await this.tenants.findById(new Types.ObjectId(tenantId)).select('-__v').lean();
    if (!tenant) throw new NotFoundException('Workspace not found');
    const names = await db.listCollections({}, { nameOnly: true }).toArray();
    const collections: Record<string, any[]> = {};
    let count = 0;
    for (const { name } of names) {
      if (name.startsWith('system.') || EXCLUDED_BACKUP_COLLECTIONS.has(name)) continue;
      const collection = db.collection(name);
      let documents: any[] = [];
      if (name === 'tenants') {
        documents = [tenant];
      } else {
        const cursor = collection.find({ tenantId: new Types.ObjectId(tenantId) });
        if (name === 'users') cursor.project({ passwordHash: 0, __v: 0 });
        documents = await cursor.limit(MAX_BACKUP_DOCUMENTS + 1).toArray();
      }
      if (documents.length > MAX_BACKUP_DOCUMENTS) throw new ConflictException(`Backup limit exceeded in collection ${name}`);
      if (documents.length) { collections[name] = documents; count += documents.length; }
      if (count > MAX_BACKUP_DOCUMENTS) throw new ConflictException('Backup exceeds the 100,000 document safety limit');
    }
    const archive = { format: 'SOLSTRA_RETAIL_TENANT_BACKUP_V1', generatedAt: new Date().toISOString(), tenantId, tenant, collections };
    const raw = Buffer.from(JSON.stringify(archive));
    const compressed = gzipSync(raw, { level: 9 });
    const checksum = createHash('sha256').update(compressed).digest('hex');
    await this.backupPolicies.updateOne(tenantFilter(tenantId, {}), { $set: { lastRunAt: new Date(), lastStatus: 'EXPORTED' } }, { upsert: true });
    return { fileName: `solstra-retail-backup-${new Date().toISOString().slice(0, 10)}.json.gz`, contentType: 'application/gzip', checksumSha256: checksum, documentCount: count, compressedBytes: compressed.length, archiveBase64: compressed.toString('base64'), note: 'Download and store this encrypted-at-rest database export in a separate cloud account or offline vault. This API does not retain a second copy in the same MongoDB cluster.' };
  }

  private gridFsBucket() {
    if (!this.connection.db) throw new ServiceUnavailableException('Database connection is unavailable');
    return new GridFSBucket(this.connection.db, { bucketName: 'solstra_tenant_backups' });
  }

  private async storeBackupArtifact(tenantId: string, archive: any, retentionDays: number) {
    const bytes = Buffer.from(archive.archiveBase64, 'base64');
    const bucket = this.gridFsBucket();
    const gridFsId = await new Promise<Types.ObjectId>((resolve, reject) => {
      const stream = bucket.openUploadStream(archive.fileName, { metadata: { tenantId, checksumSha256: archive.checksumSha256 } });
      stream.once('finish', () => resolve(stream.id as Types.ObjectId));
      stream.once('error', reject);
      stream.end(bytes);
    });
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
    const [artifact] = await this.backupArtifacts.create([{
      tenantId: new Types.ObjectId(tenantId), gridFsId, fileName: archive.fileName,
      checksumSha256: archive.checksumSha256, documentCount: archive.documentCount,
      compressedBytes: archive.compressedBytes, expiresAt,
    }]);
    return artifact;
  }

  async listBackupArtifacts(tenantId: string) {
    this.identity(tenantId);
    return this.backupArtifacts.find(tenantFilter(tenantId, { expiresAt: { $gt: new Date() } }))
      .select('-gridFsId').sort({ createdAt: -1 }).limit(50).lean();
  }

  async downloadBackupArtifact(tenantId: string, id: string) {
    this.identity(tenantId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid backup ID');
    const artifact: any = await this.backupArtifacts.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id), expiresAt: { $gt: new Date() } })).lean();
    if (!artifact) throw new NotFoundException('Backup artifact not found or expired');
    const bucket = this.gridFsBucket();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = bucket.openDownloadStream(artifact.gridFsId);
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.once('end', resolve);
      stream.once('error', reject);
    });
    const bytes = Buffer.concat(chunks);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (checksum !== artifact.checksumSha256) throw new ConflictException('Stored backup checksum verification failed');
    return { fileName: artifact.fileName, checksumSha256: checksum, archiveBase64: bytes.toString('base64') };
  }

  async runScheduledPlatformJobs() {
    let expiredBatches = 0;
    if (this.connection.db) {
      const expiredResult = await this.connection.db.collection('inventory_batches').updateMany(
        { status: 'ACTIVE', expiresAt: { $lte: new Date() } },
        { $set: { status: 'EXPIRED' } },
      );
      expiredBatches = expiredResult.modifiedCount;
    }
    const overdueInvoices = await this.subscriptionInvoices.find({ status: 'DUE', dueAt: { $lte: new Date() } }).select('tenantId').lean();
    for (const invoice of overdueInvoices) await this.tenants.updateOne({ _id: invoice.tenantId }, { $set: { billingStatus: 'PAST_DUE' } });
    const reminderCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const reminderCandidates = await this.subscriptionInvoices.find({
      status: 'DUE', dueAt: { $lte: new Date() }, reminderCount: { $lt: 7 },
      $or: [{ lastReminderAt: null }, { lastReminderAt: { $lte: reminderCutoff } }, { lastReminderAt: { $exists: false } }],
    }).limit(100).lean();
    let billingReminders = 0;
    for (const invoice of reminderCandidates) {
      const claimed: any = await this.subscriptionInvoices.findOneAndUpdate({
        _id: invoice._id, tenantId: invoice.tenantId, status: 'DUE', reminderCount: { $lt: 7 },
        $or: [{ lastReminderAt: null }, { lastReminderAt: { $lte: reminderCutoff } }, { lastReminderAt: { $exists: false } }],
      }, { $inc: { reminderCount: 1 }, $set: { lastReminderAt: new Date() } }, { new: true }).lean();
      if (!claimed) continue;
      const overdueDays = Math.max(1, Math.floor((Date.now() - new Date(invoice.dueAt).getTime()) / 86400000));
      await this.createNotification(String(invoice.tenantId), {
        title: 'Subscription payment overdue · ' + String(invoice.invoiceNumber),
        body: 'Subscription invoice ' + String(invoice.invoiceNumber) + ' is overdue by ' + overdueDays + ' day(s). Please settle the outstanding amount to avoid workspace service interruption.',
        severity: claimed.reminderCount >= 5 ? 'CRITICAL' : 'WARNING',
        category: 'BILLING', sourceId: String(invoice.invoiceNumber) + '-REMINDER-' + claimed.reminderCount,
      });
      billingReminders += 1;
    }
    const backups = await this.runScheduledBackupJobs();
    const tenantIds = await this.deliveries.distinct('tenantId', { status: 'PENDING', nextAttemptAt: { $lte: new Date() } });
    let webhookDeliveries = 0;
    for (const tenantId of tenantIds.slice(0, 20)) {
      try {
        const result = await this.runWebhookDeliveries(String(tenantId), 20);
        webhookDeliveries += result.processed;
      } catch { /* Failed delivery attempts remain queued with retry metadata. */ }
    }
    const communicationTenants = await this.communicationDeliveries.distinct('tenantId', { status: 'PENDING', nextAttemptAt: { $lte: new Date() } });
    let communicationDeliveries = 0;
    for (const tenantId of communicationTenants.slice(0, 20)) {
      try {
        const result = await this.runCommunicationDeliveries(String(tenantId), 20);
        communicationDeliveries += result.processed;
      } catch { /* Failed communication attempts retain retry state. */ }
    }
    const replicationRetryCutoff = new Date(Date.now() - 15 * 60 * 1000);
    const replicationRetries = await this.backupReplicationEvents.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: { tenantId: '$tenantId', artifactId: '$artifactId' }, status: { $first: '$status' }, createdAt: { $first: '$createdAt' } } },
      { $match: { status: 'FAILED', createdAt: { $lte: replicationRetryCutoff } } },
      { $limit: 10 },
    ]);
    let retriedReplications = 0;
    for (const retry of replicationRetries) {
      try {
        await this.replicateBackupArtifact(String(retry._id.tenantId), String(retry._id.artifactId));
        retriedReplications += 1;
      } catch { /* Replication event history records the retry failure. */ }
    }
    return { backups, webhookDeliveries, communicationDeliveries, billingReminders, expiredBatches, retriedReplications };
  }

  async runScheduledBackupJobs() {
    if (!this.connection.db) return { processed: 0 };
    const now = new Date();
    const staleRunCutoff = new Date(now.getTime() - 30 * 60 * 1000);
    const due = await this.backupPolicies.find({
      enabled: true,
      $or: [{ nextRunAt: { $lte: now } }, { lastStatus: 'RUNNING', updatedAt: { $lte: staleRunCutoff } }],
    }).limit(10).lean();
    let processed = 0;
    for (const policy of due) {
      const nextRunAt = this.nextBackupDate(policy.frequency);
      const claimFilter: any = { _id: policy._id, tenantId: policy.tenantId, enabled: true };
      if (policy.lastStatus === 'RUNNING' && new Date(policy.updatedAt).getTime() <= staleRunCutoff.getTime()) {
        claimFilter.lastStatus = 'RUNNING';
        claimFilter.updatedAt = policy.updatedAt;
      } else {
        claimFilter.nextRunAt = { $lte: new Date() };
      }
      const claimed = await this.backupPolicies.findOneAndUpdate(
        claimFilter,
        { $set: { nextRunAt, lastStatus: 'RUNNING' } },
        { new: true },
      ).lean();
      if (!claimed) continue;
      const tenantId = String(policy.tenantId);
      try {
        const archive = await this.exportTenantBackup(tenantId);
        const artifact = await this.storeBackupArtifact(tenantId, archive, Number(policy.retentionDays || 30));
        let replicationStatus = 'OFFSITE_NOT_CONFIGURED';
        try {
          const replication = await this.replicateBackupArtifact(tenantId, String(artifact._id));
          replicationStatus = replication.status;
        } catch { replicationStatus = 'OFFSITE_FAILED'; }
        await this.backupPolicies.updateOne({ _id: policy._id, tenantId: policy.tenantId }, { $set: { lastRunAt: new Date(), lastStatus: replicationStatus === 'SUCCEEDED' ? 'REPLICATED_OFFSITE' : replicationStatus === 'OFFSITE_FAILED' ? 'STORED_IN_CLUSTER_REPLICATION_FAILED' : 'STORED_IN_CLUSTER_OFFSITE_NOT_CONFIGURED' } });
        processed += 1;
      } catch (error: any) {
        await this.backupPolicies.updateOne({ _id: policy._id, tenantId: policy.tenantId }, { $set: { lastStatus: 'FAILED', nextRunAt: new Date(Date.now() + 15 * 60 * 1000) } });
      }
    }
    const expired = await this.backupArtifacts.find({ expiresAt: { $lte: new Date() } }).limit(100).lean();
    const bucket = this.gridFsBucket();
    for (const artifact of expired) {
      try { await bucket.delete(artifact.gridFsId); } catch { /* A missing GridFS file is already effectively expired. */ }
      await this.backupArtifacts.deleteOne({ _id: artifact._id });
    }
    return { processed, expiredRemoved: expired.length };
  }

  async verifyBackup(tenantId: string, dto: VerifyBackupDto) {
    this.identity(tenantId);
    let archive: any;
    try {
      const compressed = Buffer.from(dto.archiveBase64, 'base64');
      if (!compressed.length || compressed.length > 20 * 1024 * 1024) throw new Error('Archive size is invalid');
      archive = JSON.parse(gunzipSync(compressed, { maxOutputLength: 100 * 1024 * 1024 }).toString('utf8'));
    } catch { throw new BadRequestException('Backup archive is invalid, corrupt or exceeds the verification limit'); }
    if (archive?.format !== 'SOLSTRA_RETAIL_TENANT_BACKUP_V1' || archive.tenantId !== tenantId || !archive.collections || !archive.tenant) throw new BadRequestException('Backup format or workspace identity does not match');
    return { valid: true, format: archive.format, generatedAt: archive.generatedAt, tenantId, collections: Object.keys(archive.collections).map(name => ({ name, documents: archive.collections[name].length })), restoreMode: 'VALIDATION_ONLY', note: 'This endpoint verifies archive integrity and workspace ownership. It does not overwrite production data; perform recovery in an isolated database with a reviewed migration plan.' };
  }

  async valuationReconciliation(tenantId: string) {
    this.identity(tenantId);
    const products = await this.products.find(tenantFilter(tenantId, { isDeleted: false, trackStock: true })).select('name sku stockQty inventoryValue averageCost valuationInitialized').lean();
    const allocations = await this.warehouseStocks.aggregate([
      { $match: tenantFilter(tenantId, {}) },
      { $group: { _id: '$productId', quantity: { $sum: '$quantity' }, inventoryValue: { $sum: '$inventoryValue' }, warehouses: { $sum: 1 } } },
    ]);
    const byProduct = new Map(allocations.map((row: any) => [String(row._id), row]));
    const rows = products.map((product: any) => {
      const allocation: any = byProduct.get(String(product._id)) || { quantity: 0, inventoryValue: 0, warehouses: 0 };
      const qtyDelta = Number(allocation.quantity || 0) - Number(product.stockQty || 0);
      const valueDeltaPaise = Math.round((Number(allocation.inventoryValue || 0) - Number(product.inventoryValue || 0)) * 100);
      return { productId: product._id, name: product.name, sku: product.sku, stockQty: product.stockQty, allocatedQty: allocation.quantity, quantityDelta: qtyDelta, inventoryValue: product.inventoryValue, allocatedValue: allocation.inventoryValue, valueDelta: valueDeltaPaise / 100, warehouseCount: allocation.warehouses, valuationInitialized: Boolean(product.valuationInitialized), status: !product.valuationInitialized ? 'VALUATION_PENDING' : qtyDelta > 0 || valueDeltaPaise > 1 ? 'OVER_ALLOCATED' : 'REVIEW' };
    });
    const pending = rows.filter(row => row.status === 'VALUATION_PENDING');
    const overAllocated = rows.filter(row => row.status === 'OVER_ALLOCATED');
    const review = rows.filter(row => row.status === 'REVIEW');
    return { summary: { products: rows.length, valuationPending: pending.length, overAllocated: overAllocated.length, withinAggregateTotals: review.length }, pending: pending.slice(0, 100), discrepancies: overAllocated.slice(0, 100), review: review.slice(0, 100), note: 'Unallocated aggregate stock is allowed. This reconciliation flags warehouse allocations exceeding aggregate quantity or valuation; it does not silently revalue stock or alter historical journals.' };
  }

  private assertPlatformAdmin(userId: string) {
    const allowed = (this.config.get<string>('PLATFORM_ADMIN_USER_IDS') || '').split(',').map(value => value.trim()).filter(Boolean);
    if (!allowed.includes(userId)) throw new ForbiddenException('Platform operator access is not configured for this account');
  }

  async listSaasTenants(userId: string) {
    this.assertPlatformAdmin(userId);
    return this.tenants.find({}).select('name slug status subscriptionStatus subscriptionPlan maxUsers maxProducts maxBranches trialEndsAt createdAt').sort({ createdAt: -1 }).limit(500).lean();
  }

  async updateSaasTenant(userId: string, tenantId: string, dto: UpdateSaasTenantDto) {
    this.assertPlatformAdmin(userId);
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant ID');
    const updates: Record<string, any> = {};
    for (const key of ['status', 'subscriptionStatus', 'subscriptionPlan', 'maxUsers', 'maxProducts', 'maxBranches'] as const) {
      if (dto[key] !== undefined) updates[key] = dto[key];
    }
    if (dto.subscriptionPlan) {
      const limits: Record<string, { maxUsers: number; maxProducts: number; maxBranches: number }> = {
        starter: { maxUsers: 3, maxProducts: 1000, maxBranches: 1 },
        growth: { maxUsers: 10, maxProducts: 5000, maxBranches: 3 },
        business: { maxUsers: 25, maxProducts: 25000, maxBranches: 10 },
        enterprise: { maxUsers: 1000, maxProducts: 1000000, maxBranches: 1000 },
      };
      const defaults = limits[dto.subscriptionPlan];
      for (const key of ['maxUsers', 'maxProducts', 'maxBranches'] as const) {
        if (dto[key] === undefined) updates[key] = defaults[key];
      }
    }
    if (!Object.keys(updates).length || !dto.reason?.trim()) throw new BadRequestException('Provide at least one platform setting and a mandatory reason');
    const previous = await this.tenants.findById(tenantId).select('status subscriptionStatus subscriptionPlan maxUsers maxProducts maxBranches').lean();
    if (!previous) throw new NotFoundException('Tenant not found');
    const tenant = await this.tenants.findByIdAndUpdate(tenantId, { $set: updates }, { new: true, runValidators: true }).select('name slug status subscriptionStatus subscriptionPlan maxUsers maxProducts maxBranches').lean();
    if (!tenant) throw new NotFoundException('Tenant not found');
    await this.saasAudit.create({
      tenantId: new Types.ObjectId(tenantId), actorId: new Types.ObjectId(userId),
      previousValues: Object.fromEntries(Object.keys(updates).map(key => [key, (previous as any)[key]])),
      newValues: updates, reason: dto.reason.trim(),
    });
    return { tenant, auditReason: dto.reason.trim() };
  }

  async listSaasAdminAudit(userId: string) {
    this.assertPlatformAdmin(userId);
    return this.saasAudit.find({}).populate('tenantId', 'name slug').populate('actorId', 'name email').sort({ createdAt: -1 }).limit(100).lean();
  }

  async platformUsageSummary(userId: string) {
    this.assertPlatformAdmin(userId);
    const [tenants, users, products] = await Promise.all([
      this.tenants.aggregate([{ $group: { _id: '$subscriptionStatus', count: { $sum: 1 } } }]),
      this.users.countDocuments({}),
      this.products.countDocuments({ isDeleted: false }),
    ]);
    return { tenantsBySubscriptionStatus: tenants, totalUsers: users, totalProducts: products, generatedAt: new Date() };
  }

  async listCommunicationProviders(tenantId: string) {
    this.identity(tenantId);
    return this.communicationProviders.find(tenantFilter(tenantId, {})).select('-encryptedSecret -secretIv -secretTag').sort({ createdAt: -1 }).lean();
  }

  async createCommunicationProvider(tenantId: string, dto: CreateCommunicationProviderDto) {
    this.identity(tenantId);
    await this.validateWebhookUrl(dto.endpointUrl);
    const encrypted = this.encryptSecret(dto.apiToken, await this.encryptionKey());
    const row = await this.communicationProviders.create({
      tenantId: new Types.ObjectId(tenantId), name: dto.name.trim(), channel: dto.channel,
      endpointUrl: dto.endpointUrl, ...encrypted, enabled: true,
    });
    return { _id: row._id, name: row.name, channel: row.channel, endpointUrl: row.endpointUrl, enabled: row.enabled };
  }

  async rotateCommunicationProviderSecret(tenantId: string, id: string, apiToken: string) {
    this.identity(tenantId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid communication provider ID');
    if (typeof apiToken !== 'string' || apiToken.trim().length < 12 || apiToken.trim().length > 500) {
      throw new BadRequestException('Provider credential must contain 12–500 characters');
    }
    const encrypted = this.encryptSecret(apiToken.trim(), await this.encryptionKey());
    const row = await this.communicationProviders.findOneAndUpdate(
      tenantFilter(tenantId, { _id: new Types.ObjectId(id) }),
      { $set: encrypted }, { new: true },
    ).select('-encryptedSecret -secretIv -secretTag').lean();
    if (!row) throw new NotFoundException('Communication provider not found');
    return {
      provider: row,
      rotatedAt: new Date(),
      warning: 'The previous credential is invalid immediately. Update the external provider configuration before the next queued delivery.',
    };
  }

  async updateCommunicationProvider(tenantId: string, id: string, enabled: boolean) {
    this.identity(tenantId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid communication provider ID');
    const row = await this.communicationProviders.findOneAndUpdate(
      tenantFilter(tenantId, { _id: new Types.ObjectId(id) }), { $set: { enabled } }, { new: true },
    ).select('-encryptedSecret -secretIv -secretTag').lean();
    if (!row) throw new NotFoundException('Communication provider not found');
    return row;
  }

  async queueCommunication(tenantId: string, userId: string, dto: SendCommunicationDto) {
    this.identity(tenantId, userId);
    const provider: any = await this.communicationProviders.findOne(tenantFilter(tenantId, { channel: dto.channel, enabled: true })).sort({ createdAt: -1 }).lean();
    if (!provider) throw new ConflictException('Configure an enabled provider for this communication channel first');
    if (dto.channel === 'EMAIL' && !dto.recipient.includes('@')) throw new BadRequestException('Enter a valid email recipient');
    if (dto.channel !== 'EMAIL' && !/^\+?[0-9]{8,15}$/.test(dto.recipient.replace(/[\s()-]/g, ''))) throw new BadRequestException('Enter a valid international phone number');
    const row = await this.communicationDeliveries.create({
      tenantId: new Types.ObjectId(tenantId), providerId: provider._id, channel: dto.channel,
      recipient: dto.recipient.trim(), subject: dto.subject?.trim() || '', message: dto.message.trim(),
      status: 'PENDING', requestedBy: new Types.ObjectId(userId), nextAttemptAt: new Date(),
    });
    return { id: row._id, status: row.status, channel: row.channel, recipient: row.recipient, queuedAt: row.createdAt };
  }

  async listCommunicationDeliveries(tenantId: string, page = 1) {
    this.identity(tenantId);
    const safePage = Number.isInteger(page) && page > 0 ? Math.min(page, 10000) : 1;
    const filter = tenantFilter(tenantId, {});
    const [items, total] = await Promise.all([
      this.communicationDeliveries.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * 20).limit(20).select('-message').populate('providerId', 'name channel').lean(),
      this.communicationDeliveries.countDocuments(filter),
    ]);
    return { items, pagination: { page: safePage, limit: 20, total, totalPages: Math.ceil(total / 20) } };
  }

  async recordCommunicationReceipt(deliveryId: string, rawBody: Buffer | undefined, signature: string | undefined) {
    if (!Types.ObjectId.isValid(deliveryId) || !rawBody?.length || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
      throw new ForbiddenException('Invalid communication delivery receipt signature');
    }
    const delivery: any = await this.communicationDeliveries.findOne({ _id: new Types.ObjectId(deliveryId) }).lean();
    if (!delivery) throw new NotFoundException('Communication delivery not found');
    const provider: any = await this.communicationProviders.findOne(tenantFilter(String(delivery.tenantId), { _id: delivery.providerId, enabled: true }))
      .select('+encryptedSecret +secretIv +secretTag').lean();
    if (!provider) throw new ForbiddenException('Communication provider is unavailable');
    const secret = this.decryptSecret(provider, await this.encryptionKey());
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new ForbiddenException('Invalid communication delivery receipt signature');
    }
    let event: any;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new BadRequestException('Invalid communication receipt payload'); }
    if (String(event.deliveryId || '') !== deliveryId || !['delivered', 'failed'].includes(String(event.status || '').toLowerCase())) {
      throw new BadRequestException('Communication receipt does not match the delivery or has an unsupported status');
    }
    const delivered = String(event.status).toLowerCase() === 'delivered';
    const updated = await this.communicationDeliveries.findOneAndUpdate(
      { _id: delivery._id, tenantId: delivery.tenantId, status: { $in: ['DELIVERED', 'PENDING', 'DELIVERING', 'FAILED'] } },
      { $set: {
        status: delivered ? 'DELIVERED' : 'FAILED',
        providerMessageId: String(event.providerMessageId || '').slice(0, 160),
        deliveredAt: delivered ? new Date() : null,
        failedAt: delivered ? null : new Date(),
        lastError: delivered ? '' : String(event.reason || 'Provider reported delivery failure').slice(0, 500),
      } },
      { new: true },
    ).select('_id status providerMessageId deliveredAt failedAt').lean();
    if (!updated) throw new ConflictException('Communication delivery is no longer eligible for receipt updates');
    return updated;
  }

  async runCommunicationDeliveries(tenantId: string, limit = 20) {
    this.identity(tenantId);
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit) || 20));
    const stale = new Date(Date.now() - 5 * 60 * 1000);
    await this.communicationDeliveries.updateMany(tenantFilter(tenantId, { status: 'DELIVERING', updatedAt: { $lte: stale } }), { $set: { status: 'PENDING', nextAttemptAt: new Date() } });
    const due = await this.communicationDeliveries.find(tenantFilter(tenantId, { status: 'PENDING', nextAttemptAt: { $lte: new Date() } })).sort({ nextAttemptAt: 1 }).limit(safeLimit).lean();
    const key = await this.encryptionKey();
    const results: any[] = [];
    for (const delivery of due) {
      const locked = await this.communicationDeliveries.findOneAndUpdate(tenantFilter(tenantId, { _id: delivery._id, status: 'PENDING' }), { $set: { status: 'DELIVERING' } }, { new: true });
      if (!locked) continue;
      try {
        const provider: any = await this.communicationProviders.findOne(tenantFilter(tenantId, { _id: delivery.providerId, enabled: true })).select('+encryptedSecret +secretIv +secretTag').lean();
        if (!provider) throw new Error('Communication provider is disabled or unavailable');
        await this.validateWebhookUrl(provider.endpointUrl);
        const token = this.decryptSecret(provider, key);
        const body = JSON.stringify({ channel: delivery.channel, to: delivery.recipient, subject: delivery.subject, message: delivery.message, metadata: { deliveryId: String(delivery._id), tenantId } });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response: Response;
        try {
          response = await fetch(provider.endpointUrl, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-solstra-channel': delivery.channel, 'x-solstra-delivery': String(delivery._id) }, body });
        } finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error('Provider returned HTTP ' + response.status);
        await this.communicationDeliveries.updateOne(tenantFilter(tenantId, { _id: delivery._id }), { $set: { status: 'DELIVERED', lastError: '' }, $inc: { attempts: 1 } });
        await this.communicationProviders.updateOne(tenantFilter(tenantId, { _id: provider._id }), { $set: { lastDeliveredAt: new Date() } });
        results.push({ id: String(delivery._id), status: 'DELIVERED' });
      } catch (error: any) {
        const attempts = Number(delivery.attempts || 0) + 1;
        const dead = attempts >= 5;
        await this.communicationDeliveries.updateOne(tenantFilter(tenantId, { _id: delivery._id }), { $set: { status: dead ? 'DEAD' : 'PENDING', attempts, lastError: String(error?.message || 'Provider delivery failed').slice(0, 500), nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60000) } });
        results.push({ id: String(delivery._id), status: dead ? 'DEAD' : 'RETRY_SCHEDULED' });
      }
    }
    return { processed: results.length, results };
  }

  private subscriptionPlanPricePaise(plan: string) {
    const prices: Record<string, number> = { starter: 49900, growth: 149900, business: 399900 };
    return prices[plan] ?? 0;
  }

  async listSubscriptionInvoices(tenantId: string) {
    this.identity(tenantId);
    return this.subscriptionInvoices.find(tenantFilter(tenantId, {})).sort({ createdAt: -1 }).limit(50).lean();
  }

  async requestSubscriptionInvoice(tenantId: string, userId: string) {
    this.identity(tenantId, userId);
    const tenant: any = await this.tenants.findById(new Types.ObjectId(tenantId)).lean();
    if (!tenant) throw new NotFoundException('Workspace not found');
    const outstanding = await this.subscriptionInvoices.findOne(tenantFilter(tenantId, { status: 'DUE' })).lean();
    if (outstanding) throw new ConflictException('Settle the existing subscription invoice before requesting another');
    const amountPaise = this.subscriptionPlanPricePaise(tenant.subscriptionPlan || 'starter');
    if (!amountPaise) throw new ConflictException('Enterprise subscription pricing requires a platform quotation');
    const periodStart = tenant.subscriptionPeriodEnd && new Date(tenant.subscriptionPeriodEnd) > new Date() ? new Date(tenant.subscriptionPeriodEnd) : new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    const invoiceNumber = 'SRS-' + periodStart.toISOString().slice(0, 7).replace('-', '') + '-' + randomBytes(4).toString('hex').toUpperCase();
    const invoice = await this.subscriptionInvoices.create({
      tenantId: new Types.ObjectId(tenantId), invoiceNumber, plan: tenant.subscriptionPlan || 'starter',
      amountPaise, currency: 'INR', periodStart, periodEnd,
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), status: 'DUE', requestedBy: new Types.ObjectId(userId),
    });
    return invoice.toObject();
  }

  async listPlatformSubscriptionInvoices(userId: string) {
    this.assertPlatformAdmin(userId);
    return this.subscriptionInvoices.find({}).populate('tenantId', 'name slug subscriptionPlan').sort({ createdAt: -1 }).limit(200).lean();
  }

  async createSubscriptionCheckout(tenantId: string, userId: string, invoiceId: string) {
    this.identity(tenantId, userId);
    if (!Types.ObjectId.isValid(invoiceId)) throw new BadRequestException('Invalid subscription invoice ID');
    const invoice: any = await this.subscriptionInvoices.findOne(tenantFilter(tenantId, {
      _id: new Types.ObjectId(invoiceId), status: 'DUE',
    })).lean();
    if (!invoice) throw new NotFoundException('Due subscription invoice not found');
    const keyId = this.config.get<string>('RAZORPAY_KEY_ID') || '';
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET') || '';
    if (!keyId || !keySecret) throw new ServiceUnavailableException('Razorpay checkout is not configured');
    if (invoice.gatewayOrderId && invoice.paymentGateway === 'RAZORPAY') {
      return { provider: 'RAZORPAY', keyId, orderId: invoice.gatewayOrderId, amount: invoice.amountPaise, currency: invoice.currency, invoiceId: String(invoice._id) };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {
          authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          amount: invoice.amountPaise, currency: invoice.currency, receipt: invoice.invoiceNumber,
          notes: { invoiceId: String(invoice._id), tenantId },
        }),
      });
      const payload: any = await response.json().catch(() => ({}));
      if (!response.ok || !payload.id) throw new ServiceUnavailableException('Payment gateway could not create a checkout order');
      const saved = await this.subscriptionInvoices.findOneAndUpdate(
        tenantFilter(tenantId, { _id: invoice._id, status: 'DUE', gatewayOrderId: { $in: ['', null] } }),
        { $set: { paymentGateway: 'RAZORPAY', gatewayOrderId: String(payload.id) } },
        { new: true },
      ).lean();
      if (!saved) {
        const current: any = await this.subscriptionInvoices.findOne(tenantFilter(tenantId, { _id: invoice._id })).lean();
        if (current?.gatewayOrderId !== payload.id) throw new ConflictException('Subscription checkout was initialized concurrently; reload the invoice');
      }
      return { provider: 'RAZORPAY', keyId, orderId: String(payload.id), amount: invoice.amountPaise, currency: invoice.currency, invoiceId: String(invoice._id) };
    } finally { clearTimeout(timeout); }
  }

  async handleRazorpayWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const webhookSecret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET') || '';
    if (!webhookSecret || !rawBody?.length || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
      throw new ForbiddenException('Invalid payment gateway webhook signature');
    }
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest();
    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new ForbiddenException('Invalid payment gateway webhook signature');
    }
    let event: any;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new BadRequestException('Invalid payment gateway webhook payload'); }
    if (event?.event !== 'payment.captured') return { received: true, processed: false, reason: 'EVENT_IGNORED' };
    const payment = event?.payload?.payment?.entity;
    const orderId = String(payment?.order_id || '');
    const paymentId = String(payment?.id || '');
    if (!orderId || !paymentId || !Number.isSafeInteger(Number(payment?.amount)) || !String(payment?.currency || '')) {
      throw new BadRequestException('Payment capture payload is incomplete');
    }
    const session = await this.connection.startSession();
    try {
      let result: any = null;
      await session.withTransaction(async () => {
        const invoice: any = await this.subscriptionInvoices.findOne({ gatewayOrderId: orderId, paymentGateway: 'RAZORPAY' }).session(session).lean();
        if (!invoice) throw new NotFoundException('Subscription invoice for payment order was not found');
        if (Number(payment.amount) !== Number(invoice.amountPaise) || payment.currency !== invoice.currency) {
          throw new ConflictException('Captured payment amount or currency does not match the subscription invoice');
        }
        if (invoice.status === 'PAID') {
          if (invoice.paymentReference !== paymentId) throw new ConflictException('Subscription invoice was settled by a different payment');
          result = { received: true, processed: false, reason: 'DUPLICATE_PAYMENT_EVENT', invoiceId: String(invoice._id) };
          return;
        }
        if (invoice.status !== 'DUE') throw new ConflictException('Subscription invoice is not payable');
        const updated = await this.subscriptionInvoices.findOneAndUpdate(
          { _id: invoice._id, status: 'DUE', gatewayOrderId: orderId },
          { $set: { status: 'PAID', paidAt: new Date(), paymentReference: paymentId } },
          { new: true, session },
        ).lean();
        if (!updated) throw new ConflictException('Subscription invoice payment was concurrently processed');
        const planLimits: Record<string, { maxUsers: number; maxProducts: number; maxBranches: number }> = {
          starter: { maxUsers: 3, maxProducts: 1000, maxBranches: 1 },
          growth: { maxUsers: 10, maxProducts: 5000, maxBranches: 3 },
          business: { maxUsers: 25, maxProducts: 25000, maxBranches: 10 },
          enterprise: { maxUsers: 1000, maxProducts: 1000000, maxBranches: 1000 },
        };
        await this.tenants.updateOne(
          { _id: invoice.tenantId },
          { $set: { subscriptionPlan: invoice.plan, ...planLimits[invoice.plan], subscriptionStatus: 'active', billingStatus: 'CURRENT', subscriptionPeriodStart: invoice.periodStart, subscriptionPeriodEnd: invoice.periodEnd } },
          { session },
        );
        await this.saasAudit.create([{
          tenantId: invoice.tenantId, actorId: invoice.requestedBy,
          previousValues: { billingStatus: 'PAST_DUE' },
          newValues: { billingStatus: 'CURRENT', subscriptionPlan: invoice.plan, subscriptionPeriodEnd: invoice.periodEnd },
          reason: 'Razorpay payment captured: ' + paymentId,
        }], { session });
        result = { received: true, processed: true, invoiceId: String(invoice._id), paymentId };
      });
      return result;
    } finally { await session.endSession(); }
  }

  async recordSubscriptionPayment(userId: string, invoiceId: string, dto: RecordSubscriptionPaymentDto) {
    this.assertPlatformAdmin(userId);
    if (!Types.ObjectId.isValid(invoiceId)) throw new BadRequestException('Invalid subscription invoice ID');
    const session = await this.connection.startSession();
    try {
      let invoice: any;
      await session.withTransaction(async () => {
        invoice = await this.subscriptionInvoices.findOneAndUpdate(
          { _id: new Types.ObjectId(invoiceId), status: 'DUE' },
          { $set: { status: 'PAID', paidAt: new Date(), paymentReference: dto.paymentReference.trim(), recordedBy: new Types.ObjectId(userId) } },
          { new: true, session },
        ).lean();
        if (!invoice) throw new ConflictException('Subscription invoice is already settled or unavailable');
        const planLimits: Record<string, { maxUsers: number; maxProducts: number; maxBranches: number }> = {
          starter: { maxUsers: 3, maxProducts: 1000, maxBranches: 1 },
          growth: { maxUsers: 10, maxProducts: 5000, maxBranches: 3 },
          business: { maxUsers: 25, maxProducts: 25000, maxBranches: 10 },
          enterprise: { maxUsers: 1000, maxProducts: 1000000, maxBranches: 1000 },
        };
        await this.tenants.updateOne(
          { _id: invoice.tenantId },
          { $set: { subscriptionPlan: invoice.plan, ...planLimits[invoice.plan], subscriptionStatus: 'active', billingStatus: 'CURRENT', subscriptionPeriodStart: invoice.periodStart, subscriptionPeriodEnd: invoice.periodEnd } },
          { session },
        );
        await this.saasAudit.create([{
          tenantId: invoice.tenantId, actorId: new Types.ObjectId(userId),
          previousValues: { billingStatus: 'PAST_DUE' }, newValues: { billingStatus: 'CURRENT', subscriptionPlan: invoice.plan, subscriptionPeriodEnd: invoice.periodEnd },
          reason: 'Subscription payment recorded: ' + dto.paymentReference.trim(),
        }], { session });
      });
      return invoice;
    } finally { await session.endSession(); }
  }

  async listPlatformSubscriptionPlans() {
    return [
      { plan: 'starter', monthlyAmount: 499, currency: 'INR', maxUsers: 3, maxProducts: 1000, maxBranches: 1 },
      { plan: 'growth', monthlyAmount: 1499, currency: 'INR', maxUsers: 10, maxProducts: 5000, maxBranches: 3 },
      { plan: 'business', monthlyAmount: 3999, currency: 'INR', maxUsers: 25, maxProducts: 25000, maxBranches: 10 },
      { plan: 'enterprise', monthlyAmount: null, currency: 'INR', maxUsers: 1000, maxProducts: 1000000, maxBranches: 1000, note: 'Custom quotation' },
    ];
  }

  async replicateBackupArtifact(tenantId: string, artifactId: string) {
    this.identity(tenantId);
    if (!Types.ObjectId.isValid(artifactId)) throw new BadRequestException('Invalid backup artifact ID');
    const endpoint = this.config.get<string>('BACKUP_REPLICATION_ENDPOINT') || '';
    const token = this.config.get<string>('BACKUP_REPLICATION_TOKEN') || '';
    if (!endpoint || !token) {
      await this.backupReplicationEvents.create({ tenantId: new Types.ObjectId(tenantId), artifactId: new Types.ObjectId(artifactId), status: 'NOT_CONFIGURED', message: 'Configure BACKUP_REPLICATION_ENDPOINT and BACKUP_REPLICATION_TOKEN to enable off-site replication.' });
      return { status: 'NOT_CONFIGURED' };
    }
    await this.validateWebhookUrl(endpoint);
    const artifact: any = await this.backupArtifacts.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(artifactId), expiresAt: { $gt: new Date() } })).lean();
    if (!artifact) throw new NotFoundException('Backup artifact not found or expired');
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = this.gridFsBucket().openDownloadStream(artifact.gridFsId);
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.once('end', resolve);
      stream.once('error', reject);
    });
    const bytes = Buffer.concat(chunks);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (checksum !== artifact.checksumSha256) throw new ConflictException('Backup checksum verification failed before replication');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/gzip', 'x-solstra-backup-file': artifact.fileName, 'x-solstra-backup-sha256': checksum, 'x-solstra-tenant-id': tenantId }, body: new Uint8Array(bytes) });
      if (!response.ok) throw new Error('Replication target returned HTTP ' + response.status);
      let acknowledgement: any;
      try { acknowledgement = await response.json(); } catch { throw new Error('Replication receiver must return a JSON storage acknowledgement'); }
      if (acknowledgement?.status !== 'STORED' || acknowledgement?.sha256 !== checksum || String(acknowledgement?.tenantId || '') !== tenantId) {
        throw new Error('Replication receiver acknowledgement did not confirm the exact checksum and tenant');
      }
      await this.backupReplicationEvents.create({ tenantId: new Types.ObjectId(tenantId), artifactId: artifact._id, status: 'SUCCEEDED', message: 'Off-site receiver confirmed durable storage for the exact tenant archive checksum.', replicatedAt: new Date() });
      return { status: 'SUCCEEDED', checksumSha256: checksum };
    } catch (error: any) {
      await this.backupReplicationEvents.create({ tenantId: new Types.ObjectId(tenantId), artifactId: artifact._id, status: 'FAILED', message: String(error?.message || 'Replication failed').slice(0, 500) });
      throw new ServiceUnavailableException('Off-site backup replication failed; the in-cluster backup remains available for retry');
    } finally { clearTimeout(timeout); }
  }

  async runBackupRestoreDrill(tenantId: string, artifactId: string) {
    this.identity(tenantId);
    if (!Types.ObjectId.isValid(artifactId)) throw new BadRequestException('Invalid backup artifact ID');
    const artifact: any = await this.backupArtifacts.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(artifactId) })).lean();
    if (!artifact) throw new NotFoundException('Backup artifact not found in this workspace');
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = this.gridFsBucket().openDownloadStream(artifact.gridFsId);
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.once('end', resolve);
      stream.once('error', reject);
    });
    const compressed = Buffer.concat(chunks);
    const checksum = createHash('sha256').update(compressed).digest('hex');
    let status = 'FAILED';
    let message = 'Backup restore drill failed validation';
    let collectionCount = 0;
    let documentCount = 0;
    try {
      if (checksum !== artifact.checksumSha256) throw new Error('Stored archive checksum does not match artifact metadata');
      const archive: any = JSON.parse(gunzipSync(compressed).toString('utf8'));
      if (archive?.format !== 'SOLSTRA_RETAIL_TENANT_BACKUP_V1' || String(archive?.tenantId) !== tenantId || !archive?.collections || typeof archive.collections !== 'object') {
        throw new Error('Archive format or tenant identity validation failed');
      }
      const collections = Object.entries(archive.collections);
      collectionCount = collections.length;
      for (const [name, rows] of collections) {
        if (!/^[a-zA-Z0-9_]+$/.test(name) || !Array.isArray(rows)) throw new Error('Archive contains an invalid collection entry');
        for (const row of rows as any[]) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Archive contains a malformed document');
          if (row.tenantId && String(row.tenantId) !== tenantId) throw new Error('Archive contains a document from another workspace');
          documentCount += 1;
        }
      }
      status = 'PASSED';
      message = 'Checksum, gzip, archive format, tenant identity, collection structure and document ownership checks passed. No live database records were changed.';
    } catch (error: any) {
      message = String(error?.message || message).slice(0, 500);
    }
    const drill = await this.backupRestoreDrills.create({
      tenantId: new Types.ObjectId(tenantId), artifactId: artifact._id, status, message,
      collectionCount, documentCount, checksumSha256: checksum,
    });
    return { id: String(drill._id), artifactId, status, message, collectionCount, documentCount, checksumSha256: checksum, testedAt: drill.createdAt };
  }

  async listBackupRestoreDrills(tenantId: string, artifactId?: string) {
    this.identity(tenantId);
    const filter: any = tenantFilter(tenantId, {});
    if (artifactId) {
      if (!Types.ObjectId.isValid(artifactId)) throw new BadRequestException('Invalid backup artifact ID');
      filter.artifactId = new Types.ObjectId(artifactId);
    }
    return this.backupRestoreDrills.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  }

  async platformSecurityPosture(tenantId: string) {
    this.identity(tenantId);
    const configured = (key: string) => Boolean(String(this.config.get<string>(key) || '').trim());
    let replicaSet = false;
    let databaseReachable = this.connection.readyState === 1;
    if (databaseReachable && this.connection.db) {
      try {
        const hello: any = await this.connection.db.admin().command({ hello: 1 });
        replicaSet = Boolean(hello.setName);
      } catch { databaseReachable = false; }
    }
    const checks = [
      { key: 'DATABASE_CONNECTION', status: databaseReachable ? 'PASS' : 'FAIL', detail: databaseReachable ? 'Database connection is active' : 'Database connection is unavailable' },
      { key: 'DATABASE_REPLICA_SET', status: replicaSet ? 'PASS' : 'REVIEW', detail: replicaSet ? 'Replica-set topology detected; transaction support is available' : 'Replica-set topology was not confirmed; transaction-dependent workflows may fail' },
      { key: 'WEBHOOK_SECRET_ENCRYPTION', status: /^[a-fA-F0-9]{64}$/.test(this.config.get<string>('WEBHOOK_SECRET_ENCRYPTION_KEY') || '') ? 'PASS' : 'FAIL', detail: 'Webhook and communication credentials require a dedicated 32-byte encryption key' },
      { key: 'JWT_SIGNING_SECRET', status: configured('JWT_ACCESS_SECRET') || configured('JWT_SECRET') ? 'PASS' : 'REVIEW', detail: 'Confirm a strong, private JWT signing secret is configured' },
      { key: 'OFFSITE_BACKUP_RECEIVER', status: configured('OFFSITE_BACKUP_RECEIVER_URL') && configured('OFFSITE_BACKUP_RECEIVER_TOKEN') ? 'PASS' : 'REVIEW', detail: 'Off-site replication requires a receiver URL and authentication token' },
      { key: 'GST_GSP_ADAPTER', status: configured('GST_GSP_ADAPTER_URL') && configured('GST_GSP_ADAPTER_TOKEN') ? 'PASS' : 'REVIEW', detail: 'Live GST provider submission requires a certified provider adapter and credentials' },
      { key: 'RAZORPAY_WEBHOOK', status: configured('RAZORPAY_WEBHOOK_SECRET') ? 'PASS' : 'REVIEW', detail: 'Payment callback authenticity requires the gateway webhook signing secret' },
    ];
    return {
      generatedAt: new Date(),
      score: Math.round((checks.filter(item => item.status === 'PASS').length / checks.length) * 100),
      summary: { passed: checks.filter(item => item.status === 'PASS').length, review: checks.filter(item => item.status === 'REVIEW').length, failed: checks.filter(item => item.status === 'FAIL').length },
      checks,
      limitations: ['Configuration presence is checked; secret strength, rotation age and external provider connectivity are not penetration-tested.', 'This posture report is an operational checklist, not a security certification or vulnerability scan.'],
    };
  }

  async operationsMetrics(tenantId: string) {
    this.identity(tenantId);
    const filter = (extra: Record<string, any> = {}) => tenantFilter(tenantId, extra);
    const now = new Date();
    const [pendingWebhooks, deadWebhooks, pendingCommunications, deadCommunications, failedCommunications, latestBackupResult, latestReplicationResult, pendingOffline, failedOffline] = await Promise.all([
      this.deliveries.countDocuments(filter({ status: { $in: ['PENDING', 'DELIVERING'] } })),
      this.deliveries.countDocuments(filter({ status: 'DEAD' })),
      this.communicationDeliveries.countDocuments(filter({ status: { $in: ['PENDING', 'DELIVERING'] } })),
      this.communicationDeliveries.countDocuments(filter({ status: 'DEAD' })),
      this.communicationDeliveries.countDocuments(filter({ status: 'FAILED' })),
      this.backupArtifacts.findOne(filter({})).sort({ createdAt: -1 }).select('createdAt checksumSha256 compressedBytes').lean(),
      this.backupReplicationEvents.findOne(filter({})).sort({ createdAt: -1 }).select('status createdAt message artifactId').lean(),
      this.syncRecords.countDocuments(filter({ status: 'PROCESSING' })),
      this.syncRecords.countDocuments(filter({ status: 'FAILED' })),
    ]);
    const latestBackup: any = latestBackupResult;
    const latestReplication: any = latestReplicationResult;
    const backupAgeMinutes = latestBackup?.createdAt ? Math.max(0, Math.floor((now.getTime() - new Date(latestBackup.createdAt).getTime()) / 60000)) : null;
    return {
      generatedAt: now,
      service: { status: this.connection.readyState === 1 ? 'READY' : 'DEGRADED', database: this.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED' },
      queues: {
        webhooks: { pending: pendingWebhooks, dead: deadWebhooks },
        communications: { pending: pendingCommunications, failed: failedCommunications, dead: deadCommunications },
        offlineSales: { processing: pendingOffline, failed: failedOffline },
      },
      backups: {
        latestCreatedAt: latestBackup?.createdAt || null,
        latestAgeMinutes: backupAgeMinutes,
        latestChecksum: latestBackup?.checksumSha256 || null,
        latestCompressedBytes: latestBackup?.compressedBytes || 0,
        latestReplication: latestReplication ? { status: latestReplication.status, createdAt: latestReplication.createdAt, message: latestReplication.message } : null,
      },
      alerts: [
        ...(this.connection.readyState !== 1 ? [{ severity: 'CRITICAL', code: 'DATABASE_DISCONNECTED', message: 'MongoDB connection is not ready.' }] : []),
        ...(deadWebhooks ? [{ severity: 'WARNING', code: 'WEBHOOK_DEAD_LETTER', count: deadWebhooks, message: 'Webhook deliveries exhausted retry attempts.' }] : []),
        ...(deadCommunications ? [{ severity: 'WARNING', code: 'COMMUNICATION_DEAD_LETTER', count: deadCommunications, message: 'Communication deliveries exhausted retry attempts.' }] : []),
        ...(backupAgeMinutes === null ? [{ severity: 'WARNING', code: 'BACKUP_NOT_FOUND', message: 'No tenant backup artifact has been created.' }] : backupAgeMinutes > 60 * 48 ? [{ severity: 'WARNING', code: 'BACKUP_STALE', ageMinutes: backupAgeMinutes, message: 'Latest backup is older than 48 hours.' }] : []),
        ...(latestReplication?.status === 'FAILED' ? [{ severity: 'WARNING', code: 'BACKUP_REPLICATION_FAILED', message: latestReplication.message }] : []),
      ],
    };
  }

  async listBackupReplicationEvents(tenantId: string, artifactId?: string) {
    this.identity(tenantId);
    const filter: any = tenantFilter(tenantId, {});
    if (artifactId) { if (!Types.ObjectId.isValid(artifactId)) throw new BadRequestException('Invalid backup artifact ID'); filter.artifactId = new Types.ObjectId(artifactId); }
    return this.backupReplicationEvents.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  }

}
