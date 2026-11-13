import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TaxPeriodStatus = 'OPEN' | 'CLOSED';

@Schema({ _id: false })
export class TaxPeriodEvent {
  @Prop({ required: true, enum: ['CLOSED', 'REOPENED'] })
  action!: 'CLOSED' | 'REOPENED';

  @Prop({ required: true })
  at!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  by!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 500 })
  reason!: string;
}
export const TaxPeriodEventSchema = SchemaFactory.createForClass(TaxPeriodEvent);

@Schema({ timestamps: true, collection: 'tax_periods', versionKey: false })
export class TaxPeriod {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, match: /^\d{4}-\d{2}$/ })
  periodKey!: string;

  @Prop({ required: true })
  startDate!: Date;

  @Prop({ required: true })
  endDate!: Date;

  @Prop({ required: true, enum: ['OPEN', 'CLOSED'], default: 'OPEN' })
  status!: TaxPeriodStatus;

  @Prop({ type: [TaxPeriodEventSchema], default: [] })
  events!: TaxPeriodEvent[];

  @Prop({ type: Number, default: 0 })
  mutationVersion!: number;
}
export type TaxPeriodDocument = HydratedDocument<TaxPeriod>;
export const TaxPeriodSchema = SchemaFactory.createForClass(TaxPeriod);
TaxPeriodSchema.index({ tenantId: 1, periodKey: 1 }, { unique: true });
TaxPeriodSchema.index({ tenantId: 1, startDate: -1 });
