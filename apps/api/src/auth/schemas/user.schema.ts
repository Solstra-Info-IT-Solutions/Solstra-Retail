import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ _id: false })
export class UserPermissionChange {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) changedBy!: Types.ObjectId;
  @Prop({ type: [String], default: [] }) previousPermissions!: string[];
  @Prop({ type: [String], default: [] }) newPermissions!: string[];
  @Prop({ required: true, default: Date.now }) changedAt!: Date;
}
const UserPermissionChangeSchema = SchemaFactory.createForClass(UserPermissionChange);

@Schema({ _id: false })
export class UserAccountStatusChange {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) changedBy!: Types.ObjectId;
  @Prop({ required: true }) isActive!: boolean;
  @Prop({ type: String, default: '', maxlength: 300 }) reason!: string;
  @Prop({ required: true, default: Date.now }) changedAt!: Date;
}
const UserAccountStatusChangeSchema = SchemaFactory.createForClass(UserAccountStatusChange);

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true, maxlength: 80 }) name!: string;
  @Prop({ required: true, lowercase: true, trim: true, maxlength: 254 }) email!: string;
  @Prop({ required: true, select: false }) passwordHash!: string;
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true }) tenantId!: Types.ObjectId;
  @Prop({ required: true, enum: ['owner', 'admin', 'staff'], default: 'owner' }) role!: string;
  @Prop({ type: String, trim: true, default: '', maxlength: 80 }) designation!: string;
  @Prop({ type: String, trim: true, default: null, match: /^[6-9][0-9]{9}$/ }) phone?: string | null;
  @Prop({ type: [String], default: [] }) permissions!: string[];
  @Prop({ type: [UserPermissionChangeSchema], default: [] }) permissionHistory!: UserPermissionChange[];
  @Prop({ type: [UserAccountStatusChangeSchema], default: [] }) accountStatusHistory!: UserAccountStatusChange[];
  @Prop({ default: true }) isActive!: boolean;
  @Prop({ type: Number, min: 0, default: 0 }) tokenVersion!: number;
}
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, _id: 1 });