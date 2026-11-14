import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ _id: false })
export class UserPermissionChange {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  changedBy!: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  previousPermissions!: string[];

  @Prop({ type: [String], default: [] })
  newPermissions!: string[];

  @Prop({ required: true, default: Date.now })
  changedAt!: Date;
}
const UserPermissionChangeSchema = SchemaFactory.createForClass(UserPermissionChange);

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
  @Prop({ type: [UserPermissionChangeSchema], default: [] })
  permissionHistory!: UserPermissionChange[];
  @Prop({ default: true }) isActive!: boolean;
}
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, _id: 1 });
