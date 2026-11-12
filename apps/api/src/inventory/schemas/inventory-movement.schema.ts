import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InventoryMovementDocument =
  HydratedDocument<InventoryMovement>;

export type InventoryMovementType =
  | 'OPENING'
  | 'IN'
  | 'OUT'
  | 'ADJUSTMENT'
  | 'SALE'
  | 'SALE_RETURN';

@Schema({
  timestamps: true,
  collection: 'inventory_movements',
  versionKey: false,
})
export class InventoryMovement {
  @Prop({
    type: Types.ObjectId,
    ref: 'Tenant',
    required: true,
  })
  tenantId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Product',
    required: true,
  })
  productId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: ['OPENING', 'IN', 'OUT', 'ADJUSTMENT', 'SALE', 'SALE_RETURN'],
  })
  type!: InventoryMovementType;

  // Positive for stock received; negative for stock removed.
  @Prop({ required: true })
  quantityDelta!: number;

  @Prop({ required: true, min: 0 })
  previousQty!: number;

  @Prop({ required: true, min: 0 })
  newQty!: number;

  @Prop({
    required: true,
    trim: true,
    maxlength: 250,
  })
  reason!: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  performedBy!: Types.ObjectId;
}

export const InventoryMovementSchema =
  SchemaFactory.createForClass(InventoryMovement);

InventoryMovementSchema.index({
  tenantId: 1,
  productId: 1,
  createdAt: -1,
});

InventoryMovementSchema.index({
  tenantId: 1,
  createdAt: -1,
});
