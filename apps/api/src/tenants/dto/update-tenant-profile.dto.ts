import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { BUSINESS_TYPES } from '../../auth/dto/register.dto';

export class UpdateTenantProfileDto {
  @IsOptional() @IsString() @Length(2, 120) businessName?: string;
  @IsOptional() @IsString() @Length(2, 120) storeName?: string;
  @IsOptional() @IsString() @IsIn(BUSINESS_TYPES) businessType?: typeof BUSINESS_TYPES[number];
  @IsOptional() @IsString() @MaxLength(100) businessCategory?: string;
  @IsOptional() @IsString() @MaxLength(1000) businessDescription?: string;
  @IsOptional() @IsString() @MaxLength(80) ownerName?: string;
  @IsOptional() @IsString() @Matches(/^[6-9][0-9]{9}$/) ownerPhone?: string;
  @IsOptional() @IsString() @Matches(/^[6-9][0-9]{9}$/) alternatePhone?: string | null;
  @IsOptional() @IsEmail() @MaxLength(254) businessEmail?: string;
  @IsOptional() @IsString() @MaxLength(120) website?: string;
  @IsOptional() @IsBoolean() gstRegistered?: boolean;
  @IsOptional() @IsString() @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/) gstin?: string | null;
  @IsOptional() @IsString() @MaxLength(150) gstLegalName?: string;
  @IsOptional() @IsString() @MaxLength(80) gstRegistrationType?: string;
  @IsOptional() @IsString() @Matches(/^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)$/) stateCode?: string;
  @IsOptional() @IsString() @MaxLength(150) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(150) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) district?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @Matches(/^[0-9]{6}$/) pincode?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(1400000) @Matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/) logoDataUrl?: string | null;
}