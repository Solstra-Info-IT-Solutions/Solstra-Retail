import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BranchDocument = HydratedDocument<Branch>;

@Schema({ timestamps: true, collection: 'branches', versionKey: false })
export class Branch {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 2, maxlength: 120 })
  name!: string;

  @Prop({ required: true, trim: true, uppercase: true, maxlength: 24 })
  code!: string;

  @Prop({ type: String, trim: true, default: '', maxlength: 200 })
  addressLine1!: string;

  @Prop({ type: String, trim: true, default: '', maxlength: 200 })
  addressLine2!: string;

  @Prop({ type: String, trim: true, default: '', maxlength: 100 })
  city!: string;

  @Prop({ type: String, trim: true, default: '', maxlength: 100 })
  state!: string;

  @Prop({ type: String, trim: true, default: '', maxlength: 6 })
  pincode!: string;

  @Prop({ type: Boolean, default: false })
  isPrimary!: boolean;

  @Prop({ type: Boolean, default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}
export const BranchSchema = SchemaFactory.createForClass(Branch);
BranchSchema.index({ tenantId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
BranchSchema.index({ tenantId: 1, isPrimary: 1 }, { unique: true, partialFilterExpression: { isPrimary: true, isDeleted: false } });
BranchSchema.index({ tenantId: 1, isDeleted: 1, isActive: 1 });