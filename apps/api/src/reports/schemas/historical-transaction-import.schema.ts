import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'historical_transaction_import_runs', versionKey: false })
export class HistoricalTransactionImportRun {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: String, required: true, maxlength: 80 }) runKey!: string;
  @Prop({ type: String, required: true, enum: ['SALES', 'PURCHASES'] }) entity!: string;
  @Prop({ type: String, required: true, maxlength: 80 }) sourceSystem!: string;
  @Prop({ type: String, required: true, maxlength: 64 }) payloadSha256!: string;
  @Prop({ type: String, required: true, enum: ['COMMITTING', 'COMPLETED', 'PARTIAL', 'FAILED'], index: true }) status!: string;
  @Prop({ type: Number, default: 0 }) expectedDocumentCount!: number;
  @Prop({ type: Number, default: 0 }) expectedTotalPaise!: number;
  @Prop({ type: Boolean, default: false }) expectedTotalProvided!: boolean;
  @Prop({ type: Number, default: 0 }) importedCount!: number;
  @Prop({ type: Number, default: 0 }) importedTotalPaise!: number;
  @Prop({ type: [Object], default: [] }) errors!: Array<{ row: number; message: string }>;
  @Prop({ type: Date, default: null }) completedAt?: Date | null;
}
export type HistoricalTransactionImportRunDocument = HydratedDocument<HistoricalTransactionImportRun>;
export const HistoricalTransactionImportRunSchema = SchemaFactory.createForClass(HistoricalTransactionImportRun);
HistoricalTransactionImportRunSchema.index({ tenantId: 1, runKey: 1 }, { unique: true });
HistoricalTransactionImportRunSchema.index({ tenantId: 1, sourceSystem: 1, entity: 1, createdAt: -1 });

@Schema({ timestamps: true, collection: 'historical_transaction_records', versionKey: false })
export class HistoricalTransactionRecord {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'HistoricalTransactionImportRun', required: true, index: true }) importRunId!: Types.ObjectId;
  @Prop({ type: String, required: true, maxlength: 80 }) sourceSystem!: string;
  @Prop({ type: String, required: true, enum: ['SALES', 'PURCHASES'], index: true }) entity!: string;
  @Prop({ type: String, required: true, maxlength: 120 }) sourceId!: string;
  @Prop({ type: String, required: true, maxlength: 120 }) documentNumber!: string;
  @Prop({ type: Date, required: true, index: true }) sourceDate!: Date;
  @Prop({ type: Number, required: true, min: 0 }) taxableValuePaise!: number;
  @Prop({ type: Number, required: true, min: 0 }) taxAmountPaise!: number;
  @Prop({ type: Number, required: true, min: 0 }) totalAmountPaise!: number;
  @Prop({ type: String, required: true, default: 'INR', maxlength: 3 }) currency!: string;
  @Prop({ type: String, default: '', maxlength: 160 }) counterpartyName!: string;
  @Prop({ type: String, default: '', maxlength: 120 }) counterpartyReference!: string;
  @Prop({ type: String, required: true, maxlength: 64 }) payloadSha256!: string;
}
export type HistoricalTransactionRecordDocument = HydratedDocument<HistoricalTransactionRecord>;
export const HistoricalTransactionRecordSchema = SchemaFactory.createForClass(HistoricalTransactionRecord);
HistoricalTransactionRecordSchema.index({ tenantId: 1, sourceSystem: 1, entity: 1, sourceId: 1 }, { unique: true });
HistoricalTransactionRecordSchema.index({ tenantId: 1, entity: 1, sourceDate: 1 });
HistoricalTransactionRecordSchema.index({ tenantId: 1, importRunId: 1 });
