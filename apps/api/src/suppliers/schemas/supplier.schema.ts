import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplierDocument = HydratedDocument<Supplier>;

@Schema({ timestamps: true, collection: 'suppliers', versionKey: false })
export class Supplier {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 2, maxlength: 150 })
  name!: string;

  @Prop({ trim: true, maxlength: 120, default: '' })
  contactPerson!: string;

  @Prop({ trim: true, maxlength: 20, default: undefined })
  phone?: string;

  @Prop({ trim: true, lowercase: true, maxlength: 150, default: undefined })
  email?: string;

  @Prop({ trim: true, uppercase: true, maxlength: 15, default: undefined })
  gstin?: string;

  @Prop({ trim: true, maxlength: 200, default: '' })
  addressLine1!: string;

  @Prop({ trim: true, maxlength: 200, default: '' })
  addressLine2!: string;

  @Prop({ trim: true, maxlength: 100, default: '' })
  city!: string;

  @Prop({ trim: true, maxlength: 100, default: '' })
  state!: string;

  @Prop({ trim: true, maxlength: 2, match: /^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)$/, default: null })
  stateCode?: string | null;

  @Prop({ trim: true, maxlength: 10, default: '' })
  pincode!: string;

  @Prop({ trim: true, maxlength: 1000, default: '' })
  notes!: string;

  @Prop({ type: Boolean, default: false, index: true })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export const SupplierSchema = SchemaFactory.createForClass(Supplier);

SupplierSchema.index({ tenantId: 1, name: 1 });
SupplierSchema.index({ tenantId: 1, gstin: 1 });
SupplierSchema.index({ tenantId: 1, phone: 1 });
SupplierSchema.index({ tenantId: 1, isDeleted: 1 });
