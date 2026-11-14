import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PurchaseStatus = 'DRAFT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
export type PurchaseDocument = HydratedDocument<Purchase>;
export type PurchasePaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
export type ItcReviewStatus = 'NOT_REVIEWED' | 'PENDING_DOCUMENTS' | 'ELIGIBLE' | 'INELIGIBLE' | 'DISPUTED';

@Schema({ _id: false })
export class ItcReviewEvent {
  @Prop({ type: String, required: true, enum: ['NOT_REVIEWED', 'PENDING_DOCUMENTS', 'ELIGIBLE', 'INELIGIBLE', 'DISPUTED'] })
  previousStatus!: ItcReviewStatus;
  @Prop({ type: String, required: true, enum: ['PENDING_DOCUMENTS', 'ELIGIBLE', 'INELIGIBLE', 'DISPUTED'] })
  status!: Exclude<ItcReviewStatus, 'NOT_REVIEWED'>;
  @Prop({ required: true, trim: true, minlength: 5, maxlength: 500 })
  reason!: string;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  reviewedBy!: Types.ObjectId;
  @Prop({ required: true, default: Date.now })
  reviewedAt!: Date;
}

@Schema({ _id: false })
export class PurchaseItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ required: true }) name!: string;
  @Prop({ default: '' }) sku!: string;
  @Prop({ default: '' }) hsnCode!: string;
  @Prop({ default: 'pcs' }) unit!: string;
  @Prop({ required: true, min: 1 }) quantity!: number;
  @Prop({ default: 0, min: 0 }) receivedQty!: number;
  @Prop({ required: true, min: 0 }) unitCost!: number;
  @Prop({ required: true, enum: [0, 5, 12, 18, 28] }) gstRate!: number;
  @Prop({ required: true, min: 0 }) taxableValue!: number;
  @Prop({ required: true, min: 0 }) gstAmount!: number;
  @Prop({ type: Number, default: 0, min: 0 }) cgstAmount!: number;
  @Prop({ type: Number, default: 0, min: 0 }) sgstAmount!: number;
  @Prop({ type: Number, default: 0, min: 0 }) igstAmount!: number;
  @Prop({ type: Boolean, default: false }) gstSplitClassified!: boolean;
  @Prop({ required: true, min: 0 }) lineTotal!: number;
  @Prop({ required: true, default: true }) trackStock!: boolean;
}

@Schema({ _id: false })
export class PurchasePayment {
  @Prop({ required: true }) idempotencyKey!: string;
  @Prop({ required: true, enum: ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'] }) method!: PurchasePaymentMethod;
  @Prop({ required: true, min: 0.01 }) amount!: number;
  @Prop({ trim: true, default: '' }) reference!: string;
  @Prop({ required: true, default: Date.now }) paidAt!: Date;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) receivedBy!: Types.ObjectId;
}

@Schema({ _id: false })
export class PurchaseReceiptItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  quantity!: number;
}

@Schema({ _id: false })
export class PurchaseReceipt {
  @Prop({ required: true }) idempotencyKey!: string;
  @Prop({ required: true }) requestFingerprint!: string;
  @Prop({ type: [PurchaseReceiptItem], default: [] })
  items!: PurchaseReceiptItem[];
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  receivedBy!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Warehouse', default: null })
  warehouseId?: Types.ObjectId | null;
  @Prop({ required: true, default: Date.now })
  receivedAt!: Date;
}

@Schema({ timestamps: true, collection: 'purchases', versionKey: false })
export class Purchase {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true })
  purchaseNumber!: string;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true })
  supplierId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  supplierInvoiceNumber!: string;

  @Prop({ required: true, default: Date.now })
  purchaseDate!: Date;

  @Prop({ type: Date, default: null })
  supplierInvoiceDate?: Date | null;

  @Prop({ type: [PurchaseItem], required: true })
  items!: PurchaseItem[];

  @Prop({ required: true, min: 0 }) subtotal!: number;
  @Prop({ required: true, min: 0 }) gstTotal!: number;
  @Prop({ type: Number, default: 0, min: 0 }) cgstTotal!: number;
  @Prop({ type: Number, default: 0, min: 0 }) sgstTotal!: number;
  @Prop({ type: Number, default: 0, min: 0 }) igstTotal!: number;
  @Prop({ type: Boolean, default: false }) gstSplitClassified!: boolean;
  @Prop({ type: String, default: null, maxlength: 15 }) supplierGstinSnapshot?: string | null;
  @Prop({ type: String, default: null, maxlength: 2 }) supplierStateCodeSnapshot?: string | null;
  @Prop({ type: String, default: null, maxlength: 2 }) placeOfSupplyStateCode?: string | null;
  @Prop({ required: true, min: 0 }) grandTotal!: number;
  @Prop({ required: true, min: 0, default: 0 }) paidAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) dueAmount!: number;
  @Prop({ type: [PurchasePayment], default: [] }) payments!: PurchasePayment[];

  @Prop({ required: true, enum: ['DRAFT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'], default: 'DRAFT' })
  status!: PurchaseStatus;

  @Prop({ type: String, enum: ['NOT_REVIEWED', 'PENDING_DOCUMENTS', 'ELIGIBLE', 'INELIGIBLE', 'DISPUTED'], default: 'NOT_REVIEWED' })
  itcReviewStatus!: ItcReviewStatus;

  @Prop({ type: String, default: '', maxlength: 500 })
  itcReviewReason!: string;

  @Prop({ type: Date, default: null })
  itcReviewedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  itcReviewedBy?: Types.ObjectId | null;

  @Prop({ type: [ItcReviewEvent], default: [] })
  itcReviewHistory!: ItcReviewEvent[];

  @Prop({ default: '' }) notes!: string;

  @Prop({ type: [PurchaseReceipt], default: [] })
  receipts!: PurchaseReceipt[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  cancelledBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  cancelledAt?: Date | null;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);

PurchaseSchema.index({ tenantId: 1, purchaseNumber: 1 }, { unique: true });
PurchaseSchema.index({ tenantId: 1, supplierId: 1, createdAt: -1 });
PurchaseSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
PurchaseSchema.index({ tenantId: 1, createdAt: -1 });

