import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarehouseTransferDocument = HydratedDocument<WarehouseTransfer>;

@Schema({ timestamps: true, collection: 'warehouse_transfers', versionKey: false })
export class WarehouseTransfer {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true })
  sourceWarehouseId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true })
  destinationWarehouseId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Number, required: true, min: 0 })
  unitCost!: number;

  @Prop({ type: Number, required: true, min: 0 })
  inventoryValue!: number;

  @Prop({ type: String, required: true, trim: true, minlength: 5, maxlength: 250 })
  reason!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  performedBy!: Types.ObjectId;
}

export const WarehouseTransferSchema = SchemaFactory.createForClass(WarehouseTransfer);
WarehouseTransferSchema.index({ tenantId: 1, createdAt: -1 });
WarehouseTransferSchema.index({ tenantId: 1, productId: 1, createdAt: -1 });
