import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

@Schema({ timestamps: true, collection: 'accounts', versionKey: false })
export class Account {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, uppercase: true, maxlength: 20 })
  code!: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ required: true, enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] })
  type!: AccountType;

  @Prop({ trim: true, default: '' })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'Account', default: null })
  parentAccountId?: Types.ObjectId | null;

  @Prop({ default: false })
  isSystem!: boolean;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}
export type AccountDocument = HydratedDocument<Account>;
export const AccountSchema = SchemaFactory.createForClass(Account);
AccountSchema.index({ tenantId: 1, code: 1 }, { unique: true });
AccountSchema.index({ tenantId: 1, type: 1, isActive: 1 });
