import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PromotionDocument = HydratedDocument<Promotion>;

@Schema({ timestamps: true, collection: 'sales_promotions', versionKey: false })
export class Promotion {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, uppercase: true, maxlength: 40 })
  code!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ type: String, trim: true, default: '' })
  description!: string;

  @Prop({ type: String, required: true, enum: ['PERCENT', 'FIXED'] })
  discountType!: 'PERCENT' | 'FIXED';

  @Prop({ type: Number, required: true, min: 0.01 })
  discountValue!: number;

  @Prop({ type: Number, min: 0, default: 0 })
  minimumSubtotal!: number;

  @Prop({ type: Number, min: 0, default: null })
  maximumDiscount?: number | null;

  @Prop({ type: Date, required: true })
  startsAt!: Date;

  @Prop({ type: Date, required: true })
  endsAt!: Date;

  @Prop({ type: Number, min: 1, default: null })
  usageLimit?: number | null;

  @Prop({ type: Number, min: 0, default: 0 })
  usageCount!: number;

  @Prop({ type: String, required: true, enum: ['ACTIVE', 'PAUSED', 'EXPIRED'], default: 'ACTIVE', index: true })
  status!: 'ACTIVE' | 'PAUSED' | 'EXPIRED';

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}
export const PromotionSchema = SchemaFactory.createForClass(Promotion);
PromotionSchema.index({ tenantId: 1, code: 1 }, { unique: true });
PromotionSchema.index({ tenantId: 1, status: 1, startsAt: 1, endsAt: 1 });
