import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'registration_approval_requests', versionKey: false })
export class RegistrationApprovalRequest {
  @Prop({ required: true, trim: true, maxlength: 80 }) name!: string;
  @Prop({ required: true, trim: true, maxlength: 120 }) businessName!: string;
  @Prop({ required: true, trim: true, maxlength: 120 }) storeName!: string;
  @Prop({ required: true, lowercase: true, trim: true, maxlength: 254 }) email!: string;
  @Prop({ required: true, select: false }) passwordHash!: string;
  @Prop({ required: true, trim: true, match: /^[6-9][0-9]{9}$/ }) ownerPhone!: string;
  @Prop({ type: String, default: null, trim: true }) alternatePhone?: string | null;
  @Prop({ required: true, enum: ['GENERAL_RETAIL','GROCERY','MEDICAL_PHARMACY','ELECTRONICS','FASHION_APPAREL','WHOLESALE_DISTRIBUTION','E_COMMERCE','RESTAURANT_FOOD','AUTOMOTIVE','BEAUTY_COSMETICS','HARDWARE_BUILDING','OTHER'] }) businessType!: string;
  @Prop({ type: String, default: '', maxlength: 100 }) businessCategory!: string;
  @Prop({ type: String, default: '', maxlength: 1000 }) businessDescription!: string;
  @Prop({ required: true, trim: true, maxlength: 150 }) addressLine1!: string;
  @Prop({ type: String, default: '', trim: true, maxlength: 150 }) addressLine2!: string;
  @Prop({ required: true, trim: true, maxlength: 80 }) city!: string;
  @Prop({ type: String, default: '', trim: true, maxlength: 80 }) district!: string;
  @Prop({ required: true, trim: true, maxlength: 80 }) state!: string;
  @Prop({ required: true, trim: true, match: /^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)$/ }) stateCode!: string;
  @Prop({ required: true, trim: true, match: /^[0-9]{6}$/ }) pincode!: string;
  @Prop({ type: String, default: 'India', trim: true, maxlength: 80 }) country!: string;
  @Prop({ required: true, default: false }) gstRegistered!: boolean;
  @Prop({ type: String, default: null, uppercase: true, trim: true, maxlength: 15 }) gstin?: string | null;
  @Prop({ type: String, default: '', trim: true, maxlength: 150 }) gstLegalName!: string;
  @Prop({ type: String, default: '', trim: true, maxlength: 80 }) gstRegistrationType!: string;
  @Prop({ type: String, default: '', trim: true, maxlength: 254 }) businessEmail!: string;
  @Prop({ type: String, default: '', trim: true, maxlength: 120 }) website!: string;
  @Prop({ type: String, default: null, select: false, maxlength: 1400000 }) logoDataUrl?: string | null;
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
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
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