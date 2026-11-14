import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type PriceRuleDocument = HydratedDocument<PriceRule>;
@Schema({ timestamps: true, collection: 'sales_price_rules', versionKey: false })
export class PriceRule {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, uppercase: true, maxlength: 60 }) name!: string;
  @Prop({ type: String, enum: ['PRODUCT', 'CATEGORY'], required: true }) appliesTo!: 'PRODUCT' | 'CATEGORY';
  @Prop({ type: Types.ObjectId, ref: 'Product', default: null }) productId?: Types.ObjectId | null;
  @Prop({ type: String, trim: true, default: '' }) category?: string;
  @Prop({ type: String, enum: ['FIXED_PRICE', 'PERCENT_OFF', 'AMOUNT_OFF'], required: true }) ruleType!: 'FIXED_PRICE' | 'PERCENT_OFF' | 'AMOUNT_OFF';
  @Prop({ type: Number, required: true, min: 0.01 }) value!: number;
  @Prop({ type: Number, min: 1, default: 1 }) minimumQuantity!: number;
  @Prop({ type: Date, required: true }) startsAt!: Date;
  @Prop({ type: Date, required: true }) endsAt!: Date;
  @Prop({ type: Number, min: 0, default: 0 }) priority!: number;
  @Prop({ type: String, enum: ['ACTIVE', 'PAUSED'], default: 'ACTIVE', index: true }) status!: 'ACTIVE' | 'PAUSED';
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
}
export const PriceRuleSchema = SchemaFactory.createForClass(PriceRule);
PriceRuleSchema.index({ tenantId: 1, status: 1, startsAt: 1, endsAt: 1, priority: -1 });
