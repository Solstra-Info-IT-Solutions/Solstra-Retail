import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductDocument = HydratedDocument<Product>;

@Schema({
  timestamps: true,
  collection: 'products',
  versionKey: false,
})
export class Product {
  @Prop({
    type: Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  })
  tenantId!: Types.ObjectId;

  @Prop({
    required: true,
    trim: true,
    maxlength: 150,
  })
  name!: string;

  @Prop({
    trim: true,
    maxlength: 1000,
    default: '',
  })
  description!: string;

  @Prop({
    trim: true,
    maxlength: 100,
    default: '',
  })
  category!: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', default: null, index: true })
  categoryId?: Types.ObjectId | null;


  @Prop({
    trim: true,
    uppercase: true,
    maxlength: 60,
    default: undefined,
  })
  sku?: string;

  @Prop({
    trim: true,
    maxlength: 100,
    default: undefined,
  })
  barcode?: string;

  @Prop({ required: true, min: 0 })
  purchasePrice!: number;

  @Prop({ required: true, min: 0 })
  sellingPrice!: number;

  @Prop({
    type: Boolean,
    default: false,
  })
  priceIncludesTax!: boolean;

  @Prop({ required: true, min: 0 })
  mrp!: number;

  @Prop({
    required: true,
    enum: [0, 5, 12, 18, 28],
    default: 18,
  })
  gstRate!: number;

  @Prop({
    trim: true,
    maxlength: 20,
    default: '',
  })
  hsnCode!: string;

  @Prop({
    trim: true,
    default: 'pcs',
    maxlength: 30,
  })
  unit!: string;

  @Prop({
    default: 0,
    min: 0,
  })
  stockQty!: number;

  @Prop({ default: 0, min: 0 })
  averageCost!: number;

  @Prop({ default: 0, min: 0 })
  inventoryValue!: number;

  @Prop({ default: false })
  valuationInitialized!: boolean;

  @Prop({
    default: 5,
    min: 0,
  })
  lowStockThreshold!: number;

  @Prop({ default: true })
  trackStock!: boolean;

  @Prop({ type: Number, min: 0, max: 3650, default: 0 })
  warrantyDays!: number;

  @Prop({ type: String, trim: true, maxlength: 1000, default: '' })
  warrantyTerms!: string;

  @Prop({
    default: false,
    index: true,
  })
  isDeleted!: boolean;

@Prop({
  type: Date,
  default: null,
})
deletedAt?: Date | null;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

// SKU must be unique within a tenant when supplied.
ProductSchema.index(
  { tenantId: 1, sku: 1 },
  {
    unique: true,
    partialFilterExpression: { sku: { $type: 'string' } },
  },
);

// Barcode must be unique within a tenant when supplied.
ProductSchema.index(
  { tenantId: 1, barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { barcode: { $type: 'string' } },
  },
);

ProductSchema.index({ tenantId: 1, name: 1 });
ProductSchema.index({ tenantId: 1, category: 1 });
ProductSchema.index({ tenantId: 1, isDeleted: 1 });


