import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true, maxlength: 80 }) name!: string;
  @Prop({ required: true, lowercase: true, trim: true, maxlength: 254 }) email!: string;
  @Prop({ required: true, select: false }) passwordHash!: string;
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;
  @Prop({ required: true, enum: ['owner', 'admin', 'staff'], default: 'owner' })
  role!: string;
  @Prop({ type: [String], default: [] })
  permissions!: string[];
  @Prop({ default: true }) isActive!: boolean;
}
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, _id: 1 });
