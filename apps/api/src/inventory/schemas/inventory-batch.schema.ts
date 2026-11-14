import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type InventoryBatchDocument = HydratedDocument<InventoryBatch>;
@Schema({ timestamps: true, collection: 'inventory_batches', versionKey: false })
export class InventoryBatch {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true }) productId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true, index: true }) warehouseId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, uppercase: true }) batchNumber!: string;
  @Prop({ type: Date, default: null, index: true }) manufacturedAt?: Date | null;
  @Prop({ type: Date, required: true, index: true }) expiresAt!: Date;
  @Prop({ type: Number, required: true, min: 0 }) quantity!: number;
  @Prop({ type: Number, required: true, min: 0 }) unitCost!: number;
  @Prop({ type: String, enum: ['ACTIVE', 'DEPLETED', 'EXPIRED'], default: 'ACTIVE', index: true }) status!: 'ACTIVE' | 'DEPLETED' | 'EXPIRED';
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
}
export const InventoryBatchSchema = SchemaFactory.createForClass(InventoryBatch);
InventoryBatchSchema.index({ tenantId: 1, productId: 1, warehouseId: 1, batchNumber: 1 }, { unique: true });
InventoryBatchSchema.index({ tenantId: 1, status: 1, expiresAt: 1 });
