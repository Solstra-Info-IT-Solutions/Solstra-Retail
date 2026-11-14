import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

const tenantRef = { type: Types.ObjectId, ref: 'Tenant', required: true, index: true };

@Schema({ timestamps: true, collection: 'automation_rules', versionKey: false })
export class AutomationRule {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 100 }) name!: string;
  @Prop({ type: String, required: true, enum: ['MANUAL', 'SALE_CREATED', 'LOW_STOCK', 'EXPENSE_PENDING_APPROVAL'] }) eventType!: string;
  @Prop({ type: String, required: true, enum: ['NOTIFY', 'WEBHOOK'] }) actionType!: string;
  @Prop({ type: Object, default: {} }) config!: Record<string, any>;
  @Prop({ type: Boolean, default: true, index: true }) enabled!: boolean;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
  @Prop({ type: Date, default: null }) lastTriggeredAt?: Date | null;
  @Prop({ type: Number, default: 0 }) triggerCount!: number;
}
export type AutomationRuleDocument = HydratedDocument<AutomationRule>;
export const AutomationRuleSchema = SchemaFactory.createForClass(AutomationRule);
AutomationRuleSchema.index({ tenantId: 1, eventType: 1, enabled: 1 });

@Schema({ timestamps: true, collection: 'platform_notifications', versionKey: false })
export class PlatformNotification {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true }) userId?: Types.ObjectId | null;
  @Prop({ type: String, required: true, trim: true, maxlength: 120 }) title!: string;
  @Prop({ type: String, required: true, trim: true, maxlength: 2000 }) body!: string;
  @Prop({ type: String, required: true, enum: ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL'], default: 'INFO' }) severity!: string;
  @Prop({ type: String, required: true, trim: true, maxlength: 60 }) category!: string;
  @Prop({ type: String, default: '' }) sourceId!: string;
  @Prop({ type: Date, default: null, index: true }) readAt?: Date | null;
}
export type PlatformNotificationDocument = HydratedDocument<PlatformNotification>;
export const PlatformNotificationSchema = SchemaFactory.createForClass(PlatformNotification);
PlatformNotificationSchema.index({ tenantId: 1, userId: 1, readAt: 1, createdAt: -1 });
PlatformNotificationSchema.index({ tenantId: 1, userId: 1, sourceId: 1, category: 1, title: 1 }, { unique: true, partialFilterExpression: { sourceId: { $type: 'string', $gt: '' } } });

@Schema({ timestamps: true, collection: 'webhook_integrations', versionKey: false })
export class WebhookIntegration {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 100 }) name!: string;
  @Prop({ type: String, required: true, trim: true, maxlength: 2048 }) endpointUrl!: string;
  @Prop({ type: [String], default: [] }) events!: string[];
  @Prop({ type: String, required: true, select: false }) encryptedSecret!: string;
  @Prop({ type: String, required: true, select: false }) secretIv!: string;
  @Prop({ type: String, required: true, select: false }) secretTag!: string;
  @Prop({ type: Boolean, default: true, index: true }) enabled!: boolean;
  @Prop({ type: Date, default: null }) lastDeliveredAt?: Date | null;
}
export type WebhookIntegrationDocument = HydratedDocument<WebhookIntegration>;
export const WebhookIntegrationSchema = SchemaFactory.createForClass(WebhookIntegration);
WebhookIntegrationSchema.index({ tenantId: 1, enabled: 1 });

@Schema({ timestamps: true, collection: 'webhook_deliveries', versionKey: false })
export class WebhookDelivery {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'WebhookIntegration', required: true, index: true }) integrationId!: Types.ObjectId;
  @Prop({ type: String, required: true, maxlength: 80 }) eventType!: string;
  @Prop({ type: String, required: true, maxlength: 160 }) eventKey!: string;
  @Prop({ type: Object, required: true }) payload!: Record<string, any>;
  @Prop({ type: String, required: true, enum: ['PENDING', 'DELIVERING', 'DELIVERED', 'FAILED', 'DEAD'] , default: 'PENDING', index: true }) status!: string;
  @Prop({ type: Number, default: 0 }) attempts!: number;
  @Prop({ type: Date, default: Date.now, index: true }) nextAttemptAt!: Date;
  @Prop({ type: String, default: '', maxlength: 500 }) lastError!: string;
}
export type WebhookDeliveryDocument = HydratedDocument<WebhookDelivery>;
export const WebhookDeliverySchema = SchemaFactory.createForClass(WebhookDelivery);
WebhookDeliverySchema.index({ tenantId: 1, integrationId: 1, eventType: 1, eventKey: 1 }, { unique: true });

@Schema({ timestamps: true, collection: 'offline_sync_records', versionKey: false })
export class OfflineSyncRecord {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: String, required: true, maxlength: 100 }) idempotencyKey!: string;
  @Prop({ type: String, required: true, enum: ['PROCESSING', 'SUCCEEDED', 'FAILED'] }) status!: string;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SalesInvoice', default: null }) invoiceId?: Types.ObjectId | null;
  @Prop({ type: Object, default: null }) result?: Record<string, any> | null;
  @Prop({ type: String, default: '', maxlength: 500 }) errorMessage!: string;
}
export type OfflineSyncRecordDocument = HydratedDocument<OfflineSyncRecord>;
export const OfflineSyncRecordSchema = SchemaFactory.createForClass(OfflineSyncRecord);
OfflineSyncRecordSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });

@Schema({ timestamps: true, collection: 'backup_policies', versionKey: false })
export class BackupPolicy {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: Boolean, default: false }) enabled!: boolean;
  @Prop({ type: String, enum: ['DAILY', 'WEEKLY'], default: 'DAILY' }) frequency!: string;
  @Prop({ type: Number, min: 1, max: 90, default: 30 }) retentionDays!: number;
  @Prop({ type: Date, default: null }) nextRunAt?: Date | null;
  @Prop({ type: Date, default: null }) lastRunAt?: Date | null;
  @Prop({ type: String, default: 'NOT_CONFIGURED' }) lastStatus!: string;
}
export type BackupPolicyDocument = HydratedDocument<BackupPolicy>;
export const BackupPolicySchema = SchemaFactory.createForClass(BackupPolicy);
BackupPolicySchema.index({ tenantId: 1 }, { unique: true });

@Schema({ timestamps: true, collection: 'backup_artifacts', versionKey: false })
export class BackupArtifact {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) gridFsId!: Types.ObjectId;
  @Prop({ type: String, required: true, maxlength: 180 }) fileName!: string;
  @Prop({ type: String, required: true, maxlength: 64 }) checksumSha256!: string;
  @Prop({ type: Number, required: true }) documentCount!: number;
  @Prop({ type: Number, required: true }) compressedBytes!: number;
  @Prop({ type: Date, required: true, index: true }) expiresAt!: Date;
}
export type BackupArtifactDocument = HydratedDocument<BackupArtifact>;
export const BackupArtifactSchema = SchemaFactory.createForClass(BackupArtifact);
BackupArtifactSchema.index({ tenantId: 1, createdAt: -1 });
BackupArtifactSchema.index({ expiresAt: 1 });

@Schema({ timestamps: true, collection: 'saas_admin_audit', versionKey: false })
export class SaasAdminAudit {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) actorId!: Types.ObjectId;
  @Prop({ type: Object, required: true }) previousValues!: Record<string, any>;
  @Prop({ type: Object, required: true }) newValues!: Record<string, any>;
  @Prop({ type: String, required: true, trim: true, maxlength: 500 }) reason!: string;
}
export type SaasAdminAuditDocument = HydratedDocument<SaasAdminAudit>;
export const SaasAdminAuditSchema = SchemaFactory.createForClass(SaasAdminAudit);
SaasAdminAuditSchema.index({ tenantId: 1, createdAt: -1 });

@Schema({ timestamps: true, collection: 'automation_executions', versionKey: false })
export class AutomationExecution {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AutomationRule', required: true, index: true }) ruleId!: Types.ObjectId;
  @Prop({ type: String, required: true, maxlength: 160 }) eventKey!: string;
  @Prop({ type: String, required: true, enum: ['PROCESSING', 'SUCCEEDED', 'FAILED'] }) status!: string;
  @Prop({ type: String, default: '', maxlength: 500 }) errorMessage!: string;
  @Prop({ type: Date, default: Date.now }) executedAt!: Date;
}
export type AutomationExecutionDocument = HydratedDocument<AutomationExecution>;
export const AutomationExecutionSchema = SchemaFactory.createForClass(AutomationExecution);
AutomationExecutionSchema.index({ tenantId: 1, ruleId: 1, eventKey: 1 }, { unique: true });


@Schema({ timestamps: true, collection: 'communication_providers', versionKey: false })
export class CommunicationProvider {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 100 }) name!: string;
  @Prop({ type: String, required: true, enum: ['EMAIL', 'SMS', 'WHATSAPP'] }) channel!: 'EMAIL' | 'SMS' | 'WHATSAPP';
  @Prop({ type: String, required: true, trim: true, maxlength: 2048 }) endpointUrl!: string;
  @Prop({ type: String, required: true, select: false }) encryptedSecret!: string;
  @Prop({ type: String, required: true, select: false }) secretIv!: string;
  @Prop({ type: String, required: true, select: false }) secretTag!: string;
  @Prop({ type: Boolean, default: true, index: true }) enabled!: boolean;
  @Prop({ type: Date, default: null }) lastDeliveredAt?: Date | null;
}
export type CommunicationProviderDocument = HydratedDocument<CommunicationProvider>;
export const CommunicationProviderSchema = SchemaFactory.createForClass(CommunicationProvider);
CommunicationProviderSchema.index({ tenantId: 1, channel: 1, enabled: 1 });

@Schema({ timestamps: true, collection: 'communication_deliveries', versionKey: false })
export class CommunicationDelivery {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'CommunicationProvider', required: true, index: true }) providerId!: Types.ObjectId;
  @Prop({ type: String, required: true, enum: ['EMAIL', 'SMS', 'WHATSAPP'] }) channel!: string;
  @Prop({ type: String, required: true, maxlength: 320 }) recipient!: string;
  @Prop({ type: String, required: true, maxlength: 160 }) subject!: string;
  @Prop({ type: String, required: true, maxlength: 10000 }) message!: string;
  @Prop({ type: String, required: true, enum: ['PENDING', 'DELIVERING', 'DELIVERED', 'FAILED', 'DEAD'], default: 'PENDING', index: true }) status!: string;
  @Prop({ type: Number, default: 0 }) attempts!: number;
  @Prop({ type: Date, default: Date.now, index: true }) nextAttemptAt!: Date;
  @Prop({ type: String, default: '', maxlength: 500 }) lastError!: string;
  @Prop({ type: String, default: '', maxlength: 160, index: true }) providerMessageId!: string;
  @Prop({ type: Date, default: null }) deliveredAt?: Date | null;
  @Prop({ type: Date, default: null }) failedAt?: Date | null;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) requestedBy!: Types.ObjectId;
}
export type CommunicationDeliveryDocument = HydratedDocument<CommunicationDelivery>;
export const CommunicationDeliverySchema = SchemaFactory.createForClass(CommunicationDelivery);
CommunicationDeliverySchema.index({ tenantId: 1, status: 1, nextAttemptAt: 1 });

@Schema({ timestamps: true, collection: 'subscription_invoices', versionKey: false })
export class SubscriptionInvoice {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: String, required: true, unique: true, maxlength: 50 }) invoiceNumber!: string;
  @Prop({ type: String, required: true, enum: ['starter', 'growth', 'business', 'enterprise'] }) plan!: string;
  @Prop({ type: Number, required: true, min: 0 }) amountPaise!: number;
  @Prop({ type: String, required: true, default: 'INR' }) currency!: string;
  @Prop({ type: Date, required: true }) periodStart!: Date;
  @Prop({ type: Date, required: true }) periodEnd!: Date;
  @Prop({ type: Date, required: true }) dueAt!: Date;
  @Prop({ type: String, required: true, enum: ['DUE', 'PAID', 'VOID'], default: 'DUE', index: true }) status!: string;
  @Prop({ type: Date, default: null }) paidAt?: Date | null;
  @Prop({ type: String, default: '', maxlength: 120 }) paymentReference!: string;
  @Prop({ type: String, default: '', maxlength: 120, index: true }) paymentGateway!: string;
  @Prop({ type: String, default: '', maxlength: 120, index: true }) gatewayOrderId!: string;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) requestedBy!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) recordedBy?: Types.ObjectId | null;
}
export type SubscriptionInvoiceDocument = HydratedDocument<SubscriptionInvoice>;
export const SubscriptionInvoiceSchema = SchemaFactory.createForClass(SubscriptionInvoice);
SubscriptionInvoiceSchema.index({ tenantId: 1, status: 1, dueAt: 1 });
SubscriptionInvoiceSchema.index({ tenantId: 1, periodStart: 1, periodEnd: 1, status: 1 });

@Schema({ timestamps: true, collection: 'backup_replication_events', versionKey: false })
export class BackupReplicationEvent {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'BackupArtifact', required: true, index: true }) artifactId!: Types.ObjectId;
  @Prop({ type: String, required: true, enum: ['SUCCEEDED', 'FAILED', 'NOT_CONFIGURED'] }) status!: string;
  @Prop({ type: String, default: '', maxlength: 500 }) message!: string;
  @Prop({ type: Date, default: null }) replicatedAt?: Date | null;
}
export type BackupReplicationEventDocument = HydratedDocument<BackupReplicationEvent>;
export const BackupReplicationEventSchema = SchemaFactory.createForClass(BackupReplicationEvent);
BackupReplicationEventSchema.index({ tenantId: 1, artifactId: 1, createdAt: -1 });


@Schema({ timestamps: true, collection: 'backup_restore_drills', versionKey: false })
export class BackupRestoreDrill {
  @Prop(tenantRef) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'BackupArtifact', required: true, index: true }) artifactId!: Types.ObjectId;
  @Prop({ type: String, required: true, enum: ['PASSED', 'FAILED'], index: true }) status!: string;
  @Prop({ type: String, default: '', maxlength: 500 }) message!: string;
  @Prop({ type: Number, default: 0 }) collectionCount!: number;
  @Prop({ type: Number, default: 0 }) documentCount!: number;
  @Prop({ type: String, required: true, maxlength: 64 }) checksumSha256!: string;
  @Prop({ type: Date, default: Date.now }) testedAt!: Date;
}
export type BackupRestoreDrillDocument = HydratedDocument<BackupRestoreDrill>;
export const BackupRestoreDrillSchema = SchemaFactory.createForClass(BackupRestoreDrill);
BackupRestoreDrillSchema.index({ tenantId: 1, artifactId: 1, createdAt: -1 });
