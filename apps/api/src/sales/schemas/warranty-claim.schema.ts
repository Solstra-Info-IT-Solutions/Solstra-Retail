import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarrantyClaimDocument = HydratedDocument<WarrantyClaim>;

@Schema({ _id: false })
export class WarrantyClaimEvent {
  @Prop({ type: String, required: true, enum: ['OPEN', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'] })
  status!: 'OPEN' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'RESOLVED';
  @Prop({ type: String, required: true, trim: true, maxlength: 500 }) reason!: string;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) actorId!: Types.ObjectId;
  @Prop({ type: Date, required: true, default: Date.now }) occurredAt!: Date;
}
export const WarrantyClaimEventSchema = SchemaFactory.createForClass(WarrantyClaimEvent);

@Schema({ timestamps: true, collection: 'warranty_claims', versionKey: false })
export class WarrantyClaim {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Warranty', required: true, index: true })
  warrantyId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SalesInvoice', required: true, index: true })
  invoiceId!: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  claimCode!: string;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: String, required: true, trim: true, maxlength: 1000 })
  issueDescription!: string;

  @Prop({ type: String, required: true, enum: ['OPEN', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'], default: 'OPEN', index: true })
  status!: 'OPEN' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'RESOLVED';

  @Prop({ type: String, default: '' })
  reviewReason!: string;

  @Prop({ type: String, enum: ['REPAIR', 'EXCHANGE', 'REFUND', null], default: null })
  resolutionType?: 'REPAIR' | 'EXCHANGE' | 'REFUND' | null;

  @Prop({ type: Types.ObjectId, ref: 'CreditNote', default: null })
  creditNoteId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'SalesInvoice', default: null })
  replacementInvoiceId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt?: Date | null;

  @Prop({ type: [WarrantyClaimEventSchema], default: [] })
  history!: WarrantyClaimEvent[];
}
export const WarrantyClaimSchema = SchemaFactory.createForClass(WarrantyClaim);
WarrantyClaimSchema.index({ tenantId: 1, warrantyId: 1, createdAt: -1 });
WarrantyClaimSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
