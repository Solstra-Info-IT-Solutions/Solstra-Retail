import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'gst_einvoice_submissions', versionKey: false })
export class GstEInvoiceSubmission {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SalesInvoice', required: true, index: true }) invoiceId!: Types.ObjectId;
  @Prop({ type: String, required: true, maxlength: 60 }) invoiceNumber!: string;
  @Prop({ type: String, required: true, enum: ['PENDING', 'SUBMITTED', 'FAILED', 'CANCELLED'], default: 'PENDING' }) status!: string;
  @Prop({ type: String, default: '', maxlength: 64 }) payloadSha256!: string;
  @Prop({ type: String, default: '', maxlength: 120 }) cancellationReference!: string;
  @Prop({ type: String, default: '', maxlength: 500 }) cancellationReason!: string;
  @Prop({ type: Date, default: null }) cancelledAt?: Date | null;
  @Prop({ type: String, default: '', maxlength: 120 }) providerReference!: string;
  @Prop({ type: String, default: '', maxlength: 120 }) irn!: string;
  @Prop({ type: String, default: '', maxlength: 120 }) acknowledgementNumber!: string;
  @Prop({ type: String, default: '', maxlength: 20000 }) signedQrCode!: string;
  @Prop({ type: Date, default: null }) acknowledgementDate?: Date | null;
  @Prop({ type: String, default: '', maxlength: 500 }) lastError!: string;
  @Prop({ type: Number, default: 0 }) attempts!: number;
  @Prop({ type: Date, default: null }) submittedAt?: Date | null;
}
export type GstEInvoiceSubmissionDocument = HydratedDocument<GstEInvoiceSubmission>;
export const GstEInvoiceSubmissionSchema = SchemaFactory.createForClass(GstEInvoiceSubmission);
GstEInvoiceSubmissionSchema.index({ tenantId: 1, invoiceId: 1 }, { unique: true });
GstEInvoiceSubmissionSchema.index({ tenantId: 1, status: 1, updatedAt: -1 });
