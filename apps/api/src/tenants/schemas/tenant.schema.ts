import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TenantDocument = HydratedDocument<Tenant>;

@Schema({ timestamps: true, collection: 'tenants' })
export class Tenant {
  @Prop({ required: true, trim: true, maxlength: 120 }) name!: string;
  @Prop({ required: true, unique: true, lowercase: true, trim: true }) slug!: string;
  @Prop({ required: true, enum: ['active', 'suspended'], default: 'active' })
  status!: string;
  @Prop({ required: true, default: 'trial' }) subscriptionStatus!: string;
  @Prop({ required: true }) trialStartedAt!: Date;
  @Prop({ required: true }) trialEndsAt!: Date;
}
export const TenantSchema = SchemaFactory.createForClass(Tenant);
TenantSchema.index({ slug: 1 }, { unique: true });
