import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TenantDocument = HydratedDocument<Tenant>;
export type TenantStatus = 'active' | 'suspended';
export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'cancelled';

@Schema({ timestamps: true, collection: 'tenants', versionKey: false })
export class Tenant {
  @Prop({ required: true, trim: true, maxlength: 120 }) name!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 120 }) storeName!: string;
  @Prop({ type: String, enum: ['GENERAL_RETAIL','GROCERY','MEDICAL_PHARMACY','ELECTRONICS','FASHION_APPAREL','WHOLESALE_DISTRIBUTION','E_COMMERCE','RESTAURANT_FOOD','AUTOMOTIVE','BEAUTY_COSMETICS','HARDWARE_BUILDING','OTHER'], default: 'GENERAL_RETAIL', index: true }) businessType!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 100 }) businessCategory!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 1000 }) businessDescription!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 254 }) businessEmail!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 120 }) website!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 80 }) ownerName!: string;
  @Prop({ type: String, trim: true, default: null, match: /^[6-9][0-9]{9}$/ }) ownerPhone?: string | null;
  @Prop({ type: String, trim: true, default: null }) alternatePhone?: string | null;
  @Prop({ type: String, trim: true, default: '', maxlength: 80 }) state!: string;
  @Prop({ type: String, trim: true, uppercase: true, default: null, maxlength: 15 }) gstin?: string | null;
  @Prop({ type: Boolean, default: false, index: true }) gstRegistered!: boolean;
  @Prop({ type: String, trim: true, default: '', maxlength: 150 }) gstLegalName!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 80 }) gstRegistrationType!: string;
  @Prop({ type: String, trim: true, default: null, match: /^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)$/ }) stateCode?: string | null;
  @Prop({ type: String, trim: true, default: '', maxlength: 150 }) addressLine1!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 150 }) addressLine2!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 80 }) city!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 80 }) district!: string;
  @Prop({ type: String, trim: true, default: '', match: /^[0-9]{6}$/ }) pincode!: string;
  @Prop({ type: String, trim: true, default: 'India', maxlength: 80 }) country!: string;
  @Prop({ type: String, default: null, select: false, maxlength: 1400000 }) logoDataUrl?: string | null;
  @Prop({ required: true, unique: true, lowercase: true, trim: true, maxlength: 140 }) slug!: string;
  @Prop({ required: true, enum: ['active', 'suspended'], default: 'active' }) status!: TenantStatus;
  @Prop({ required: true, enum: ['trial', 'active', 'expired', 'cancelled'], default: 'trial' }) subscriptionStatus!: SubscriptionStatus;
  @Prop({ required: true }) trialStartedAt!: Date;
  @Prop({ required: true }) trialEndsAt!: Date;
  @Prop({ type: String, enum: ['starter', 'growth', 'business', 'enterprise'], default: 'starter', index: true }) subscriptionPlan!: 'starter' | 'growth' | 'business' | 'enterprise';
  @Prop({ type: Number, min: 1, default: 3 }) maxUsers!: number;
  @Prop({ type: Number, min: 1, default: 1000 }) maxProducts!: number;
  @Prop({ type: Number, min: 1, default: 1 }) maxBranches!: number;
  @Prop({ type: Date, default: null }) subscriptionPeriodStart?: Date | null;
  @Prop({ type: Date, default: null }) subscriptionPeriodEnd?: Date | null;
  @Prop({ type: String, enum: ['CURRENT', 'PAST_DUE', 'CANCELLED'], default: 'CURRENT' }) billingStatus!: 'CURRENT' | 'PAST_DUE' | 'CANCELLED';
}
export const TenantSchema = SchemaFactory.createForClass(Tenant);