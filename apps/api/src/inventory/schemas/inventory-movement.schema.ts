import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InventoryMovementDocument =
  HydratedDocument<InventoryMovement>;

export interface InventoryMovementValuation {
  unitCostPaise?: number;
  productPreviousValuePaise?: number;
  productValueDeltaPaise?: number;
  productNewValuePaise?: number;
  warehousePreviousValuePaise?: number;
  warehouseValueDeltaPaise?: number;
  warehouseNewValuePaise?: number;
}

export type InventoryMovementType =
  | 'OPENING'
  | 'IN'
  | 'OUT'
  | 'ADJUSTMENT'
  | 'SALE'
  | 'SALE_RETURN'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'VALUATION';

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

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', default: null, index: true })
  warehouseId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'WarehouseTransfer', default: null, index: true })
  transferId?: Types.ObjectId | null;

  @Prop({
    type: String,
    required: true,
    enum: ['OPENING', 'IN', 'OUT', 'ADJUSTMENT', 'SALE', 'SALE_RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'VALUATION'],
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
    type: {
      unitCostPaise: { type: Number, min: 0 },
      productPreviousValuePaise: { type: Number, min: 0 },
      productValueDeltaPaise: { type: Number },
      productNewValuePaise: { type: Number, min: 0 },
      warehousePreviousValuePaise: { type: Number, min: 0 },
      warehouseValueDeltaPaise: { type: Number },
      warehouseNewValuePaise: { type: Number, min: 0 },
    },
    default: undefined,
  })
  valuation?: InventoryMovementValuation;

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

InventoryMovementSchema.index({ tenantId: 1, warehouseId: 1, createdAt: -1 });
InventoryMovementSchema.index({ tenantId: 1, transferId: 1 });
