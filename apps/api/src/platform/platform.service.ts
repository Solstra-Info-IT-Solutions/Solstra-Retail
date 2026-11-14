import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, ServiceUnavailableException, OnModuleInit, OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { GridFSBucket } from 'mongodb';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';
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
  AutomationExecution, AutomationRule, BackupArtifact, BackupPolicy, OfflineSyncRecord, PlatformNotification, SaasAdminAudit,
  WebhookDelivery, WebhookIntegration, CommunicationProvider, CommunicationDelivery, SubscriptionInvoice, BackupReplicationEvent,
} from './schemas/platform.schema';
import {
  BackupPolicyDto, CreateAutomationRuleDto, CreateWebhookDto, OfflineSyncBatchDto,
  TriggerAutomationDto, UpdateAutomationRuleDto, UpdateSaasTenantDto,
  UpdateWebhookDto, VerifyBackupDto, CreateCommunicationProviderDto, SendCommunicationDto, RecordSubscriptionPaymentDto,
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

  async syncOfflineSales(tenantId: string, userId: string, dto: OfflineSyncBatchDto) {
    this.identity(tenantId, userId);
    const results: any[] = [];
    for (const operation of dto.operations) {
      const existing: any = await this.syncRecords.findOne(tenantFilter(tenantId, { idempotencyKey: operation.idempotencyKey })).lean();
      if (existing?.status === 'SUCCEEDED') { results.push({ idempotencyKey: operation.idempotencyKey, status: 'SUCCEEDED', result: existing.result, replayed: true }); continue; }
      if (existing?.status === 'PROCESSING' && new Date(existing.updatedAt || existing.createdAt).getTime() > Date.now() - 5 * 60 * 1000) { results.push({ idempotencyKey: operation.idempotencyKey, status: 'PROCESSING', replayed: true }); continue; }
      if (existing?.status === 'PROCESSING') {
        const recovered = await this.syncRecords.findOneAndUpdate(tenantFilter(tenantId, { _id: existing._id, status: 'PROCESSING', updatedAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) } }), { $set: { status: 'PROCESSING', errorMessage: '' } }, { new: true }).lean();
        if (!recovered) { results.push({ idempotencyKey: operation.idempotencyKey, status: 'PROCESSING', replayed: true }); continue; }
      }
      if (!existing) {
        try {
          await this.syncRecords.create({ tenantId: new Types.ObjectId(tenantId), idempotencyKey: operation.idempotencyKey, status: 'PROCESSING', createdBy: new Types.ObjectId(userId) });
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          results.push({ idempotencyKey: operation.idempotencyKey, status: 'PROCESSING', replayed: true }); continue;
        }
      } else {
        await this.syncRecords.updateOne(tenantFilter(tenantId, { _id: existing._id, status: 'FAILED' }), { $set: { status: 'PROCESSING', errorMessage: '' } });
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
    return { accepted: dto.operations.length, results };
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
    const backups = await this.runScheduledBackupJobs();
    const tenantIds = await this.deliveries.distinct('tenantId', { status: 'PENDING', nextAttemptAt: { $lte: new Date() } });
    let webhookDeliveries = 0;
    for (const tenantId of tenantIds.slice(0, 20)) {
      try {
        const result = await this.runWebhookDeliveries(String(tenantId), 20);
        webhookDeliveries += result.processed;
      } catch { /* Failed delivery attempts remain queued with retry metadata. */ }
    }
    return { backups, webhookDeliveries };
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
        await this.storeBackupArtifact(tenantId, archive, Number(policy.retentionDays || 30));
        await this.backupPolicies.updateOne({ _id: policy._id, tenantId: policy.tenantId }, { $set: { lastRunAt: new Date(), lastStatus: 'STORED_IN_CLUSTER' } });
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
}
