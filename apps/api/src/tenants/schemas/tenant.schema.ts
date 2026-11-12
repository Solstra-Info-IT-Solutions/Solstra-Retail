
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TenantDocument = HydratedDocument<Tenant>;

export type TenantStatus = 'active' | 'suspended';

export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'expired'
  | 'cancelled';

@Schema({
  timestamps: true,
  collection: 'tenants',
  versionKey: false,
})
export class Tenant {
  @Prop({
    required: true,
    trim: true,
    maxlength: 120,
  })
  name!: string;

  @Prop({
    type: String,
    trim: true,
    uppercase: true,
    default: null,
    maxlength: 15,
  })
  gstin?: string | null;

  @Prop({
    type: String,
    trim: true,
    default: null,
    match: /^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)$/,
  })
  stateCode?: string | null;

  @Prop({ type: String, trim: true, default: '', maxlength: 150 })
  addressLine1!: string;

  @Prop({ type: String, trim: true, default: '', maxlength: 150 })
  addressLine2!: string;

  @Prop({ type: String, trim: true, default: '', maxlength: 80 })
  city!: string;

  @Prop({ type: String, trim: true, default: '', maxlength: 80 })
  district!: string;

  @Prop({
    type: String,
    trim: true,
    default: '',
    match: /^[0-9]{6}$/,
  })
  pincode!: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 140,
  })
  slug!: string;

  @Prop({
    required: true,
    enum: ['active', 'suspended'],
    default: 'active',
  })
  status!: TenantStatus;

  @Prop({
    required: true,
    enum: ['trial', 'active', 'expired', 'cancelled'],
    default: 'trial',
  })
  subscriptionStatus!: SubscriptionStatus;

  @Prop({
    required: true,
  })
  trialStartedAt!: Date;

  @Prop({
    required: true,
  })
  trialEndsAt!: Date;
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);
