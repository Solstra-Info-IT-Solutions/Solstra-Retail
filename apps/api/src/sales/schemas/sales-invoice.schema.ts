import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InvoiceStatus = 'ISSUED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'CREDITED';
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';

@Schema({ _id: false })
export class InvoiceLineItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ default: '' })
  sku!: string;

  @Prop({ default: '' })
  hsnCode!: string;

  @Prop({ required: true })
  unit!: string;

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

  @Prop({ required: true, default: false })
  priceIncludesTax!: boolean;

  @Prop({ required: true, default: false })
  stockTracked!: boolean;

  @Prop({ required: true, min: 0, default: 0 })
  unitCostAtSale!: number;

  @Prop({ required: true, min: 0, default: 0 })
  costOfGoodsSold!: number;

  @Prop({ required: true, default: 0 })
  cgstAmount!: number;

  @Prop({ required: true, default: 0 })
  sgstAmount!: number;

  @Prop({ required: true, default: 0 })
  igstAmount!: number;

  @Prop({ required: true, default: 0 })
  totalTax!: number;

  @Prop({ required: true, min: 0 })
  lineTotal!: number;
}

export const InvoiceLineItemSchema =
  SchemaFactory.createForClass(InvoiceLineItem);

@Schema({ _id: false })
export class InvoicePayment {
  @Prop({ type: String, default: null, trim: true })
  idempotencyKey?: string | null;

  @Prop({
    required: true,
    enum: ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'],
  })
  method!: PaymentMethod;

  @Prop({ required: true, min: 0.01 })
  amount!: number;

  @Prop({ trim: true, default: '' })
  reference!: string;

  @Prop({ type: Date, required: true, default: Date.now })
  paidAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  receivedBy!: Types.ObjectId;
}

export const InvoicePaymentSchema =
  SchemaFactory.createForClass(InvoicePayment);

@Schema({
  timestamps: true,
  collection: 'sales_invoices',
  versionKey: false,
})
export class SalesInvoice {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId!: Types.ObjectId;
  @Prop({ required: true, trim: true, lowercase: true })
  idempotencyKey!: string;

  @Prop({ required: true, trim: true })
  requestFingerprint!: string;

  @Prop({ default: 0, min: 0 })
  costingVersion!: number;

  @Prop({ required: true, trim: true })
  invoiceNumber!: string;

  @Prop({ required: true, trim: true })
  financialYear!: string;

  @Prop({ type: Date, required: true, default: Date.now })
  invoiceDate!: Date;

  @Prop({ required: true })
  sellerName!: string;

  @Prop({ type: String, default: null })
  sellerGstin?: string | null;

  @Prop({ required: true })
  sellerStateCode!: string;

  @Prop({ default: '' })
  sellerAddress!: string;
  @Prop({ type: Types.ObjectId, ref: 'Customer', default: null })
  customerId?: Types.ObjectId | null;

  @Prop({ default: '' })
  customerName!: string;

  @Prop({ default: '' })
  customerPhone!: string;

  @Prop({ type: String, default: null })
  customerGstin?: string | null;

  @Prop({ required: true })
  placeOfSupplyStateCode!: string;

  @Prop({ type: [InvoiceLineItemSchema], required: true })
  items!: InvoiceLineItem[];

  @Prop({ required: true, min: 0 })
  subtotal!: number;

  @Prop({ required: true, min: 0 })
  discountTotal!: number;

  @Prop({ required: true, min: 0 })
  taxableValue!: number;

  @Prop({ required: true, min: 0 })
  cgstTotal!: number;

  @Prop({ required: true, min: 0 })
  sgstTotal!: number;

  @Prop({ required: true, min: 0 })
  igstTotal!: number;

  @Prop({ required: true, min: 0 })
  totalTax!: number;

  @Prop({ required: true, min: 0 })
  grandTotal!: number;

  @Prop({ required: true, min: 0, default: 0 })
  creditedAmount!: number;

  @Prop({ required: true, min: 0, default: 0 })
  paidAmount!: number;

  @Prop({ required: true, min: 0, default: 0 })
  dueAmount!: number;

  @Prop({
    required: true,
    enum: ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'CREDITED'],
    default: 'UNPAID',
  })
  paymentStatus!: PaymentStatus;

  @Prop({ type: [InvoicePaymentSchema], default: [] })
  payments!: InvoicePayment[];

  @Prop({
    required: true,
    enum: ['ISSUED', 'CANCELLED'],
    default: 'ISSUED',
  })
  status!: InvoiceStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  cancelledBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  cancelledAt?: Date | null;

  @Prop({ trim: true, default: '' })
  cancellationReason!: string;
}

export type SalesInvoiceDocument = HydratedDocument<SalesInvoice>;

export const SalesInvoiceSchema =
  SchemaFactory.createForClass(SalesInvoice);

SalesInvoiceSchema.index(
  { tenantId: 1, invoiceNumber: 1 },
  { unique: true },
);

SalesInvoiceSchema.index({ tenantId: 1, invoiceDate: -1 });
SalesInvoiceSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

SalesInvoiceSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: 'string' },
    },
  },
);
