import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type JournalStatus = 'POSTED' | 'REVERSED';

@Schema({ _id: false })
export class JournalLine {
  @Prop({ type: Types.ObjectId, ref: 'Account', required: true })
  accountId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  accountCode!: string;

  @Prop({ required: true, trim: true })
  accountName!: string;

  @Prop({ required: true, min: 0, default: 0 })
  debit!: number;

  @Prop({ required: true, min: 0, default: 0 })
  credit!: number;

  @Prop({ trim: true, default: '' })
  description!: string;
}
export const JournalLineSchema = SchemaFactory.createForClass(JournalLine);

@Schema({ timestamps: true, collection: 'journal_entries', versionKey: false })
export class JournalEntry {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  entryNumber!: string;

  @Prop({ required: true })
  postingDate!: Date;

  @Prop({ required: true, trim: true })
  financialYear!: string;

  @Prop({ required: true, trim: true, maxlength: 500 })
  narration!: string;

  @Prop({ required: true, enum: ['MANUAL', 'SALES', 'PURCHASE', 'PAYMENT', 'REFUND', 'REVERSAL'] })
  sourceType!: string;

  @Prop({ type: String, default: null, trim: true })
  sourceId?: string | null;

  @Prop({ type: [JournalLineSchema], required: true })
  lines!: JournalLine[];

  @Prop({ required: true, min: 0 })
  totalDebit!: number;

  @Prop({ required: true, min: 0 })
  totalCredit!: number;

  @Prop({ required: true, enum: ['POSTED', 'REVERSED'], default: 'POSTED' })
  status!: JournalStatus;

  @Prop({ type: Types.ObjectId, ref: 'JournalEntry' })
  reversalOf?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'JournalEntry', default: null })
  reversedBy?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  postedAt!: Date;
}
export type JournalEntryDocument = HydratedDocument<JournalEntry>;
export const JournalEntrySchema = SchemaFactory.createForClass(JournalEntry);
JournalEntrySchema.index({ tenantId: 1, entryNumber: 1 }, { unique: true });
JournalEntrySchema.index({ tenantId: 1, postingDate: -1, createdAt: -1 });
JournalEntrySchema.index(
  { tenantId: 1, sourceType: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $type: 'string' } } },
);
JournalEntrySchema.index(
  { tenantId: 1, reversalOf: 1 },
  { unique: true, partialFilterExpression: { reversalOf: { $type: 'objectId' } } },
);
