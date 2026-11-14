import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type StocktakeDocument = HydratedDocument<Stocktake>;
@Schema({ _id: false })
export class StocktakeLine {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true }) productId!: Types.ObjectId;
  @Prop({ type: Number, required: true, min: 0 }) expectedQty!: number;
  @Prop({ type: Number, required: true, min: 0 }) countedQty!: number;
  @Prop({ type: Number, required: true }) variance!: number;
  @Prop({ type: String, trim: true, maxlength: 250, default: '' }) note!: string;
}
export const StocktakeLineSchema = SchemaFactory.createForClass(StocktakeLine);
@Schema({ timestamps: true, collection: 'inventory_stocktakes', versionKey: false })
export class Stocktake {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true, index: true }) warehouseId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 250 }) reference!: string;
  @Prop({ type: String, enum: ['DRAFT', 'COMPLETED', 'CANCELLED'], default: 'DRAFT', index: true }) status!: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  @Prop({ type: [StocktakeLineSchema], default: [] }) lines!: StocktakeLine[];
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) completedBy?: Types.ObjectId | null;
  @Prop({ type: Date, default: null }) completedAt?: Date | null;
}
export const StocktakeSchema = SchemaFactory.createForClass(Stocktake);
StocktakeSchema.index({ tenantId: 1, warehouseId: 1, reference: 1 }, { unique: true });
StocktakeSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
