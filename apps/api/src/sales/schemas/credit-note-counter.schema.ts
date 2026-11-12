import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({
  timestamps: true,
  collection: 'credit_note_counters',
  versionKey: false,
})
export class CreditNoteCounter {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  financialYear!: string;

  @Prop({ required: true, min: 0, default: 0 })
  sequence!: number;
}

export type CreditNoteCounterDocument =
  HydratedDocument<CreditNoteCounter>;

export const CreditNoteCounterSchema =
  SchemaFactory.createForClass(CreditNoteCounter);

CreditNoteCounterSchema.index(
  { tenantId: 1, financialYear: 1 },
  { unique: true },
);
