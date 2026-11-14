import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateAutomationRuleDto {
  @IsString() @Length(3, 100) name!: string;
  @IsIn(['MANUAL', 'SALE_CREATED', 'LOW_STOCK', 'EXPENSE_PENDING_APPROVAL']) eventType!: string;
  @IsIn(['NOTIFY', 'WEBHOOK']) actionType!: string;
  @IsOptional() @IsObject() config?: Record<string, any>;
}
export class UpdateAutomationRuleDto { @IsBoolean() enabled!: boolean; }
export class TriggerAutomationDto {
  @IsIn(['MANUAL', 'SALE_CREATED', 'LOW_STOCK', 'EXPENSE_PENDING_APPROVAL']) eventType!: string;
  @IsString() @MaxLength(160) eventKey!: string;
  @IsOptional() @IsObject() payload?: Record<string, any>;
}
export class CreateWebhookDto {
  @IsString() @Length(3, 100) name!: string;
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2048) endpointUrl!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsIn(['SALE_CREATED', 'LOW_STOCK', 'EXPENSE_PENDING_APPROVAL', 'MANUAL'], { each: true }) events!: string[];
}
export class UpdateWebhookDto { @IsBoolean() enabled!: boolean; }
export class OfflineSaleOperationDto {
  @IsString() @Length(8, 100) idempotencyKey!: string;
  @IsIn(['SALE']) type!: string;
  @IsObject() payload!: Record<string, any>;
}
export class OfflineSyncBatchDto {
  @IsOptional() @IsUUID() deviceId?: string;
  @IsOptional() @IsInt() @Min(1) batchSequence?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OfflineSaleOperationDto) operations!: OfflineSaleOperationDto[];
}
export class RegisterOfflineDeviceDto {
  @IsUUID() deviceId!: string;
  @IsString() @Length(2, 100) label!: string;
}

export class BackupPolicyDto {
  @IsBoolean() enabled!: boolean;
  @IsIn(['DAILY', 'WEEKLY']) frequency!: string;
  @IsInt() @Min(1) @Max(90) retentionDays!: number;
}
export class VerifyBackupDto { @IsString() @Length(1, 30000000) archiveBase64!: string; }
export class UpdateSaasTenantDto {
  @IsOptional() @IsIn(['trial', 'active', 'expired', 'cancelled']) subscriptionStatus?: 'trial' | 'active' | 'expired' | 'cancelled';
  @IsOptional() @IsIn(['starter', 'growth', 'business', 'enterprise']) subscriptionPlan?: 'starter' | 'growth' | 'business' | 'enterprise';
  @IsOptional() @IsIn(['active', 'suspended']) status?: 'active' | 'suspended';
  @IsOptional() @IsInt() @Min(1) @Max(10000) maxUsers?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000000) maxProducts?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxBranches?: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class CreateCommunicationProviderDto {
  @IsString() @Length(3, 100) name!: string;
  @IsIn(['EMAIL', 'SMS', 'WHATSAPP']) channel!: 'EMAIL' | 'SMS' | 'WHATSAPP';
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2048) endpointUrl!: string;
  @IsString() @Length(12, 500) apiToken!: string;
}
export class SendCommunicationDto {
  @IsIn(['EMAIL', 'SMS', 'WHATSAPP']) channel!: 'EMAIL' | 'SMS' | 'WHATSAPP';
  @IsString() @Length(3, 320) recipient!: string;
  @IsOptional() @IsString() @MaxLength(160) subject?: string;
  @IsString() @Length(1, 10000) message!: string;
}
export class RecordSubscriptionPaymentDto {
  @IsString() @Length(3, 120) paymentReference!: string;
}
