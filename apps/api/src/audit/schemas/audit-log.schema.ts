import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'audit_logs', versionKey: false })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 30 })
  actorRole!: string;

  @Prop({ required: true, trim: true, maxlength: 12 })
  action!: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  resource!: string;

  @Prop({ trim: true, maxlength: 120, default: '' })
  resourceId!: string;

  @Prop({ required: true, trim: true, maxlength: 300 })
  route!: string;

  @Prop({ trim: true, maxlength: 80, default: '' })
  ipAddress!: string;

  @Prop({ trim: true, maxlength: 300, default: '' })
  userAgent!: string;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  occurredAt!: Date;
}
export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ tenantId: 1, occurredAt: -1 });
AuditLogSchema.index({ tenantId: 1, resource: 1, occurredAt: -1 });
