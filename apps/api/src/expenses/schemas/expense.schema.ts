import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ExpensePaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
export type ExpenseStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

@Schema({ _id: false })
export class ExpensePayment {
  @Prop({ required: true, trim: true }) idempotencyKey!: string;
  @Prop({ required: true, enum: ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'] }) method!: ExpensePaymentMethod;
  @Prop({ required: true, min: 0.01 }) amount!: number;
  @Prop({ trim: true, default: '' }) reference!: string;
  @Prop({ required: true, default: Date.now }) paidAt!: Date;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) paidBy!: Types.ObjectId;
}
export const ExpensePaymentSchema = SchemaFactory.createForClass(ExpensePayment);

@Schema({ timestamps: true, collection: 'expenses', versionKey: false })
export class Expense {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ required: true, trim: true, maxlength: 120 }) title!: string;
  @Prop({ required: true, trim: true, maxlength: 60 }) category!: string;
  @Prop({ trim: true, default: '', maxlength: 1000 }) description!: string;
  @Prop({ required: true, min: 0.01 }) amount!: number;
  @Prop({ required: true, default: Date.now }) expenseDate!: Date;
  @Prop({ trim: true, default: '', maxlength: 120 }) payee!: string;
  @Prop({ trim: true, default: '', maxlength: 100 }) reference!: string;
  @Prop({ trim: true, default: '', maxlength: 500 }) attachmentUrl!: string;
  @Prop({ required: true, enum: ['UNPAID', 'PARTIALLY_PAID', 'PAID'], default: 'UNPAID' }) status!: ExpenseStatus;
  @Prop({ required: true, min: 0, default: 0 }) paidAmount!: number;
  @Prop({ required: true, min: 0 }) dueAmount!: number;
  @Prop({ type: [ExpensePaymentSchema], default: [] }) payments!: ExpensePayment[];
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
}
export type ExpenseDocument = HydratedDocument<Expense>;
export const ExpenseSchema = SchemaFactory.createForClass(Expense);
ExpenseSchema.index({ tenantId: 1, expenseDate: -1, createdAt: -1 });
ExpenseSchema.index({ tenantId: 1, status: 1, expenseDate: -1 });
ExpenseSchema.index({ tenantId: 1, category: 1, expenseDate: -1 });
