import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarrantyDocument = HydratedDocument<Warranty>;

@Schema({ timestamps: true, collection: 'product_warranties', versionKey: false })
export class Warranty {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SalesInvoice', required: true, index: true })
  invoiceId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', default: null, index: true })
  customerId?: Types.ObjectId | null;

  @Prop({ type: Number, required: true, min: 0 })
  lineIndex!: number;

  @Prop({ type: String, required: true })
  invoiceNumber!: string;

  @Prop({ type: String, required: true })
  productName!: string;

  @Prop({ type: String, default: '' })
  sku!: string;

  @Prop({ type: String, default: '' })
  customerName!: string;

  @Prop({ type: String, default: '' })
  customerPhone!: string;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Number, required: true, min: 1 })
  warrantyDays!: number;

  @Prop({ type: Number, min: 0, default: 0 })
  claimedQuantity!: number;

  @Prop({ type: String, default: '' })
  terms!: string;

  @Prop({ type: Date, required: true })
  purchaseDate!: Date;

  @Prop({ type: Date, required: true, index: true })
  coverageEndsAt!: Date;

  @Prop({ type: String, required: true, enum: ['ACTIVE', 'EXPIRED', 'CLAIMED'], default: 'ACTIVE', index: true })
  status!: 'ACTIVE' | 'EXPIRED' | 'CLAIMED';
}
export const WarrantySchema = SchemaFactory.createForClass(Warranty);
WarrantySchema.index({ tenantId: 1, invoiceId: 1, lineIndex: 1 }, { unique: true });
WarrantySchema.index({ tenantId: 1, customerId: 1, coverageEndsAt: -1 });
