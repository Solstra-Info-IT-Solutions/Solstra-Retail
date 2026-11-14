import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LoyaltyLedgerDocument = HydratedDocument<LoyaltyLedger>;

@Schema({ timestamps: true, collection: 'customer_loyalty_ledger', versionKey: false })
export class LoyaltyLedger {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['SALE_EARN', 'MANUAL_ADJUSTMENT'] })
  eventType!: 'SALE_EARN' | 'MANUAL_ADJUSTMENT';

  @Prop({ type: String, required: true, enum: ['SALE', 'MANUAL'] })
  sourceType!: 'SALE' | 'MANUAL';

  @Prop({ type: String, required: true, trim: true })
  sourceId!: string;

  @Prop({ type: Number, required: true, min: 1 })
  points!: number;

  @Prop({ type: Number, required: true })
  pointsDelta!: number;

  @Prop({ type: Number, required: true, min: 0 })
  balanceAfter!: number;

  @Prop({ type: String, required: true, trim: true, maxlength: 250 })
  reason!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}
export const LoyaltyLedgerSchema = SchemaFactory.createForClass(LoyaltyLedger);
LoyaltyLedgerSchema.index({ tenantId: 1, sourceType: 1, sourceId: 1, eventType: 1 }, { unique: true });
LoyaltyLedgerSchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });
