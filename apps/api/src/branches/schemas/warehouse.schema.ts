import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarehouseDocument = HydratedDocument<Warehouse>;

@Schema({ timestamps: true, collection: 'warehouses', versionKey: false })
export class Warehouse {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Branch', required: true, index: true })
  branchId!: Types.ObjectId;

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

  @Prop({ type: Boolean, default: false })
  isDefault!: boolean;

  @Prop({ type: Boolean, default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}
export const WarehouseSchema = SchemaFactory.createForClass(Warehouse);
WarehouseSchema.index({ tenantId: 1, branchId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
WarehouseSchema.index({ tenantId: 1, branchId: 1, isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true, isDeleted: false } });
WarehouseSchema.index({ tenantId: 1, branchId: 1, isDeleted: 1, isActive: 1 });