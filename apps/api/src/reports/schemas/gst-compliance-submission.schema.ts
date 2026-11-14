import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'gst_compliance_submissions', versionKey: false })
export class GstComplianceSubmission {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: String, required: true, enum: ['GSTR1', 'GSTR3B', 'EWAY_BILL'], index: true }) submissionType!: string;
  @Prop({ type: String, required: true, maxlength: 40, index: true }) periodKey!: string;
  @Prop({ type: String, required: true, maxlength: 120 }) sourceReference!: string;
  @Prop({ type: String, required: true, enum: ['PENDING', 'SUBMITTED', 'FAILED'], default: 'PENDING', index: true }) status!: string;
  @Prop({ type: String, default: '', maxlength: 120 }) providerReference!: string;
  @Prop({ type: String, default: '', maxlength: 120 }) acknowledgementNumber!: string;
  @Prop({ type: Date, default: null }) acknowledgementDate?: Date | null;
  @Prop({ type: String, default: '', maxlength: 500 }) lastError!: string;
  @Prop({ type: Number, default: 0 }) attempts!: number;
  @Prop({ type: String, required: true, maxlength: 64 }) payloadSha256!: string;
  @Prop({ type: Date, default: null }) submittedAt?: Date | null;
}
export type GstComplianceSubmissionDocument = HydratedDocument<GstComplianceSubmission>;
export const GstComplianceSubmissionSchema = SchemaFactory.createForClass(GstComplianceSubmission);
GstComplianceSubmissionSchema.index({ tenantId: 1, submissionType: 1, periodKey: 1, sourceReference: 1 }, { unique: true });
GstComplianceSubmissionSchema.index({ tenantId: 1, createdAt: -1 });
