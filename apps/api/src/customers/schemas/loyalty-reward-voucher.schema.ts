import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LoyaltyRewardVoucherDocument = HydratedDocument<LoyaltyRewardVoucher>;

@Schema({ timestamps: true, collection: 'customer_loyalty_vouchers', versionKey: false })
export class LoyaltyRewardVoucher {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId!: Types.ObjectId;

  @Prop({ type: String, required: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ type: Number, required: true, min: 100 })
  pointsRedeemed!: number;

  @Prop({ type: Number, required: true, min: 0.01 })
  discountAmount!: number;

  @Prop({ type: String, required: true, enum: ['AVAILABLE', 'REDEEMED', 'EXPIRED'], default: 'AVAILABLE', index: true })
  status!: 'AVAILABLE' | 'REDEEMED' | 'EXPIRED';

  @Prop({ type: Date, required: true, index: true })
  expiresAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'SalesInvoice', default: null })
  redeemedInvoiceId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  redeemedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}
export const LoyaltyRewardVoucherSchema = SchemaFactory.createForClass(LoyaltyRewardVoucher);
LoyaltyRewardVoucherSchema.index({ tenantId: 1, code: 1 }, { unique: true });
LoyaltyRewardVoucherSchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });
LoyaltyRewardVoucherSchema.index({ tenantId: 1, status: 1, expiresAt: 1 });
