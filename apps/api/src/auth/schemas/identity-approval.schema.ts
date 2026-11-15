import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'registration_approval_requests', versionKey: false })
export class RegistrationApprovalRequest {
  @Prop({ required: true, trim: true, maxlength: 80 }) name!: string;
  @Prop({ required: true, trim: true, maxlength: 100 }) businessName!: string;
  @Prop({ required: true, lowercase: true, trim: true, maxlength: 254 }) email!: string;
  @Prop({ required: true, select: false }) passwordHash!: string;
  @Prop({ type: String, enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED'], default: 'PENDING_APPROVAL', index: true }) status!: string;
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) reviewedBy?: Types.ObjectId | null;
  @Prop({ type: Date, default: null }) reviewedAt?: Date | null;
  @Prop({ type: String, default: '', maxlength: 500 }) reviewReason!: string;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
}
export type RegistrationApprovalRequestDocument = HydratedDocument<RegistrationApprovalRequest>;
export const RegistrationApprovalRequestSchema = SchemaFactory.createForClass(RegistrationApprovalRequest);
RegistrationApprovalRequestSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { status: 'PENDING_APPROVAL' } });
RegistrationApprovalRequestSchema.index({ status: 1, createdAt: 1 });
RegistrationApprovalRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

@Schema({ timestamps: true, collection: 'password_change_approval_requests', versionKey: false })
export class PasswordChangeApprovalRequest {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ required: true, lowercase: true, trim: true, maxlength: 254 }) email!: string;
  @Prop({ required: true, select: false }) newPasswordHash!: string;
  @Prop({ type: String, enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'], default: 'PENDING_APPROVAL', index: true }) status!: string;
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) reviewedBy?: Types.ObjectId | null;
  @Prop({ type: Date, default: null }) reviewedAt?: Date | null;
  @Prop({ type: String, default: '', maxlength: 500 }) reviewReason!: string;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
}
export type PasswordChangeApprovalRequestDocument = HydratedDocument<PasswordChangeApprovalRequest>;
export const PasswordChangeApprovalRequestSchema = SchemaFactory.createForClass(PasswordChangeApprovalRequest);
PasswordChangeApprovalRequestSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'PENDING_APPROVAL' } });
PasswordChangeApprovalRequestSchema.index({ status: 1, createdAt: 1 });
PasswordChangeApprovalRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
