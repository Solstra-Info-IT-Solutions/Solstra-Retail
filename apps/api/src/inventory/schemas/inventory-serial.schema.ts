import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type InventorySerialDocument = HydratedDocument<InventorySerial>;
@Schema({ timestamps: true, collection: 'inventory_serials', versionKey: false })
export class InventorySerial {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true }) productId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true, index: true }) warehouseId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, uppercase: true }) serialNumber!: string;
  @Prop({ type: String, enum: ['IN_STOCK', 'SOLD', 'RETURNED', 'DAMAGED'], default: 'IN_STOCK', index: true }) status!: 'IN_STOCK' | 'SOLD' | 'RETURNED' | 'DAMAGED';
  @Prop({ type: Types.ObjectId, ref: 'SalesInvoice', default: null }) saleInvoiceId?: Types.ObjectId | null;
  @Prop({ type: Date, default: null }) soldAt?: Date | null;
  @Prop({ type: [Object], default: [] }) lifecycleHistory!: Array<{ from: string; to: string; reason: string; actorId: Types.ObjectId; saleInvoiceId?: Types.ObjectId; changedAt: Date }>;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
}
export const InventorySerialSchema = SchemaFactory.createForClass(InventorySerial);
InventorySerialSchema.index({ tenantId: 1, serialNumber: 1 }, { unique: true });
InventorySerialSchema.index({ tenantId: 1, productId: 1, warehouseId: 1, status: 1 });
