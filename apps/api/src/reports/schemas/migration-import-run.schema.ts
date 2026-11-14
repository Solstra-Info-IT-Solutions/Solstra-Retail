import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'migration_import_runs', versionKey: false })
export class MigrationImportRun {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ type: String, required: true, maxlength: 80 }) runKey!: string;
  @Prop({ type: String, required: true, enum: ['customers', 'suppliers'] }) entity!: string;
  @Prop({ type: String, required: true, maxlength: 64 }) payloadSha256!: string;
  @Prop({ type: String, required: true, enum: ['COMMITTING', 'COMPLETED', 'PARTIAL', 'FAILED'], index: true }) status!: string;
  @Prop({ type: Number, default: 0 }) totalRows!: number;
  @Prop({ type: Number, default: 0 }) createdCount!: number;
  @Prop({ type: Number, default: 0 }) skippedCount!: number;
  @Prop({ type: [Object], default: [] }) errors!: Array<{ row: number; message: string }>;
  @Prop({ type: Date, default: null }) completedAt?: Date | null;
}
export type MigrationImportRunDocument = HydratedDocument<MigrationImportRun>;
export const MigrationImportRunSchema = SchemaFactory.createForClass(MigrationImportRun);
MigrationImportRunSchema.index({ tenantId: 1, runKey: 1 }, { unique: true });
MigrationImportRunSchema.index({ tenantId: 1, entity: 1, createdAt: -1 });
