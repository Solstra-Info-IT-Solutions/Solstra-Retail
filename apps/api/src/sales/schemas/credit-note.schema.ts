import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class CreditNoteBatchAllocation {
  @Prop({ type: Types.ObjectId, required: true }) batchId!: Types.ObjectId;
  @Prop({ type: Number, required: true, min: 0.001 }) quantity!: number;
}
export const CreditNoteBatchAllocationSchema = SchemaFactory.createForClass(CreditNoteBatchAllocation);

@Schema({ _id: false })
export class CreditNoteLine {
  @Prop({ required: true, min: 0 })
  lineIndex!: number;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ default: '' })
  sku!: string;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ required: true, min: 0 })
  unitPrice!: number;

  @Prop({ required: true, min: 0 })
  discountAmount!: number;

  @Prop({ required: true, min: 0 })
  taxableValue!: number;

  @Prop({ required: true, enum: [0, 5, 12, 18, 28] })
  gstRate!: number;

  @Prop({ required: true, min: 0, default: 0 })
  cgstAmount!: number;

  @Prop({ required: true, min: 0, default: 0 })
  sgstAmount!: number;

  @Prop({ required: true, min: 0, default: 0 })
  igstAmount!: number;

  @Prop({ required: true, min: 0, default: 0 })
  totalTax!: number;

  @Prop({ required: true, min: 0 })
  lineTotal!: number;

  @Prop({ required: true, default: false })
  restocked!: boolean;

  @Prop({ type: [String], default: [] })
  serialNumbers!: string[];

  @Prop({ type: [CreditNoteBatchAllocationSchema], default: [] })
  batchAllocations!: CreditNoteBatchAllocation[];
}

export const CreditNoteLineSchema =
  SchemaFactory.createForClass(CreditNoteLine);

export type RefundMethod =
  | 'CASH'
  | 'UPI'
  | 'CARD'
  | 'BANK_TRANSFER'
  | 'OTHER';

@Schema({ _id: false })
export class CreditNoteRefund {
  @Prop({ required: true, trim: true })
  idempotencyKey!: string;

  @Prop({
    required: true,
    enum: ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'],
  })
  method!: RefundMethod;

  @Prop({ required: true, min: 0.01 })
  amount!: number;

  @Prop({ trim: true, default: '' })
  reference!: string;

  @Prop({ type: Date, required: true, default: Date.now })
  refundedAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  refundedBy!: Types.ObjectId;
}

export const CreditNoteRefundSchema =
  SchemaFactory.createForClass(CreditNoteRefund);

@Schema({
  timestamps: true,
  collection: 'credit_notes',
  versionKey: false,
})
export class CreditNote {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SalesInvoice', required: true })
  invoiceId!: Types.ObjectId;

  @Prop({ required: true, trim: true, lowercase: true })
  idempotencyKey!: string;

  @Prop({ required: true, trim: true })
  requestFingerprint!: string;

  @Prop({ required: true, trim: true })
  creditNoteNumber!: string;

  @Prop({ required: true, trim: true })
  financialYear!: string;

  @Prop({ type: Date, required: true, default: Date.now })
  creditNoteDate!: Date;

  @Prop({ required: true, trim: true })
  originalInvoiceNumber!: string;

  @Prop({ type: [CreditNoteLineSchema], required: true })
  items!: CreditNoteLine[];

  @Prop({ required: true, min: 0 })
  discountTotal!: number;

  @Prop({ required: true, min: 0 })
  taxableValue!: number;

  @Prop({ required: true, min: 0, default: 0 })
  cgstTotal!: number;

  @Prop({ required: true, min: 0, default: 0 })
  sgstTotal!: number;

  @Prop({ required: true, min: 0, default: 0 })
  igstTotal!: number;

  @Prop({ required: true, min: 0 })
  totalTax!: number;

  @Prop({ required: true, min: 0 })
  totalAmount!: number;

  @Prop({ required: true, min: 0, default: 0 })
  appliedToDueAmount!: number;

  @Prop({ required: true, min: 0, default: 0 })
  refundableAmount!: number;

  @Prop({ required: true, min: 0, default: 0 })
  refundedAmount!: number;

  @Prop({ type: [CreditNoteRefundSchema], default: [] })
  refunds!: CreditNoteRefund[];

  @Prop({ required: true, trim: true, maxlength: 250 })
  reason!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

export type CreditNoteDocument = HydratedDocument<CreditNote>;

export const CreditNoteSchema =
  SchemaFactory.createForClass(CreditNote);

CreditNoteSchema.index(
  { tenantId: 1, creditNoteNumber: 1 },
  { unique: true },
);

CreditNoteSchema.index(
  { tenantId: 1, invoiceId: 1, createdAt: -1 },
);

CreditNoteSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true },
);
