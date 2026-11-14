import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RecurringExpenseFrequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type RecurringExpenseStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED';

@Schema({ timestamps: true, collection: 'recurring_expense_schedules', versionKey: false })
export class RecurringExpenseSchedule {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
  @Prop({ required: true, trim: true, maxlength: 120 }) title!: string;
  @Prop({ required: true, trim: true, maxlength: 60 }) category!: string;
  @Prop({ trim: true, default: '', maxlength: 1000 }) description!: string;
  @Prop({ required: true, min: 0.01 }) amount!: number;
  @Prop({ trim: true, default: '', maxlength: 120 }) payee!: string;
  @Prop({ trim: true, default: '', maxlength: 100 }) reference!: string;
  @Prop({ type: String, required: true, enum: ['MONTHLY', 'QUARTERLY', 'YEARLY'] }) frequency!: RecurringExpenseFrequency;
  @Prop({ required: true }) nextRunAt!: Date;
  @Prop({ required: true }) anchorDay!: number;
  @Prop({ type: Date, default: null }) endDate!: Date | null;
  @Prop({ type: String, required: true, enum: ['ACTIVE', 'PAUSED', 'COMPLETED'], default: 'ACTIVE', index: true }) status!: RecurringExpenseStatus;
  @Prop({ type: Date, default: null }) lastGeneratedAt!: Date | null;
  @Prop({ type: String, default: null, trim: true }) lastGeneratedPeriod!: string | null;
}
export type RecurringExpenseScheduleDocument = HydratedDocument<RecurringExpenseSchedule>;
export const RecurringExpenseScheduleSchema = SchemaFactory.createForClass(RecurringExpenseSchedule);
RecurringExpenseScheduleSchema.index({ tenantId: 1, status: 1, nextRunAt: 1 });
