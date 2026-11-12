import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true, collection: 'categories', versionKey: false })
export class Category {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  normalizedName!: string;

  @Prop({ trim: true, maxlength: 500, default: '' })
  description!: string;

  @Prop({ type: Boolean, default: false, index: true })
  isDeleted!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export const CategorySchema = SchemaFactory.createForClass(Category);

CategorySchema.index(
  { tenantId: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

CategorySchema.index({ tenantId: 1, isDeleted: 1, name: 1 });
