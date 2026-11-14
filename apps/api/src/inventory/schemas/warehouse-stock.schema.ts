import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarehouseStockDocument = HydratedDocument<WarehouseStock>;

@Schema({ timestamps: true, collection: 'warehouse_stock', versionKey: false })
export class WarehouseStock {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true, index: true })
  warehouseId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  quantity!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  inventoryValue!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  averageCost!: number;
}

export const WarehouseStockSchema = SchemaFactory.createForClass(WarehouseStock);
WarehouseStockSchema.index({ tenantId: 1, warehouseId: 1, productId: 1 }, { unique: true });
WarehouseStockSchema.index({ tenantId: 1, productId: 1, warehouseId: 1 });
