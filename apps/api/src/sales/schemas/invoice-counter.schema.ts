import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({
  timestamps: true,
  collection: 'invoice_counters',
  versionKey: false,
})
export class InvoiceCounter {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  financialYear!: string;

  @Prop({ required: true, min: 0, default: 0 })
  sequence!: number;
}

export type InvoiceCounterDocument = HydratedDocument<InvoiceCounter>;

export const InvoiceCounterSchema =
  SchemaFactory.createForClass(InvoiceCounter);

InvoiceCounterSchema.index(
  { tenantId: 1, financialYear: 1 },
  { unique: true },
);
