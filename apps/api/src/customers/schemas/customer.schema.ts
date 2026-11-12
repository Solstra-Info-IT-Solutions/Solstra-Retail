import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({
  timestamps: true,
  collection: 'customers',
  versionKey: false,
})
export class Customer {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 2, maxlength: 120 })
  name!: string;

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

  @Prop({ trim: true, maxlength: 10, default: '' })
  pincode!: string;

  @Prop({ trim: true, maxlength: 1000, default: '' })
  notes!: string;

  @Prop({ type: Boolean, default: false, index: true })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);

CustomerSchema.index(
  { tenantId: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: 'string' } },
  },
);

CustomerSchema.index(
  { tenantId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { email: { $type: 'string' } },
  },
);

CustomerSchema.index({ tenantId: 1, name: 1 });
CustomerSchema.index({ tenantId: 1, isDeleted: 1 });
