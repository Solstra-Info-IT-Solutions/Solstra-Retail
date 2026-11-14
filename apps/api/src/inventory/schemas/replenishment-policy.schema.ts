import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReplenishmentPolicyDocument = HydratedDocument<ReplenishmentPolicy>;

@Schema({ timestamps: true, collection: 'replenishment_policies', versionKey: false })
export class ReplenishmentPolicy {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true, index: true })
  warehouseId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  reorderPoint!: number;

  @Prop({ type: Number, required: true, min: 1 })
  targetStock!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  safetyStock!: number;

  @Prop({ type: Number, required: true, min: 0, default: 7 })
  leadTimeDays!: number;

  @Prop({ type: Number, required: true, min: 1, default: 1 })
  minimumOrderQty!: number;

  @Prop({ type: Number, required: true, min: 1, default: 1 })
  packSize!: number;

  @Prop({ type: Boolean, default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', default: null })
  preferredSupplierId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;
}

export const ReplenishmentPolicySchema = SchemaFactory.createForClass(ReplenishmentPolicy);
ReplenishmentPolicySchema.index(
  { tenantId: 1, warehouseId: 1, productId: 1 },
  { unique: true },
);
ReplenishmentPolicySchema.index({ tenantId: 1, isActive: 1, warehouseId: 1 });
