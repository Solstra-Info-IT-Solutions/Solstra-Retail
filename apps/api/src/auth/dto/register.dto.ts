import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

export const BUSINESS_TYPES = ['GENERAL_RETAIL','GROCERY','MEDICAL_PHARMACY','ELECTRONICS','FASHION_APPAREL','WHOLESALE_DISTRIBUTION','E_COMMERCE','RESTAURANT_FOOD','AUTOMOTIVE','BEAUTY_COSMETICS','HARDWARE_BUILDING','OTHER'] as const;

export class RegisterDto {
  @IsString() @Length(2, 80) name!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(12, 72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).+$/, { message: 'Password must include lowercase, uppercase and a number' })
  password!: string;
  @IsString() @Length(2, 120) businessName!: string;
  @IsString() @Matches(/^[6-9][0-9]{9}$/) ownerPhone!: string;
  @IsOptional() @IsString() @Matches(/^[6-9][0-9]{9}$/) alternatePhone?: string;
  @IsString() @Length(2, 120) storeName!: string;
  @IsString() @IsIn([...BUSINESS_TYPES]) businessType!: typeof BUSINESS_TYPES[number];
  @IsOptional() @IsString() @MaxLength(100) businessCategory?: string;
  @IsOptional() @IsString() @MaxLength(1000) businessDescription?: string;
  @IsString() @Length(5, 150) addressLine1!: string;
  @IsOptional() @IsString() @MaxLength(150) addressLine2?: string;
  @IsString() @Length(2, 80) city!: string;
  @IsOptional() @IsString() @MaxLength(80) district?: string;
  @IsString() @Length(2, 80) state!: string;
  @IsString() @Matches(/^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)$/) stateCode!: string;
  @IsString() @Matches(/^[0-9]{6}$/) pincode!: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsBoolean() gstRegistered!: boolean;
  @ValidateIf((o) => o.gstRegistered === true)
  @IsString() @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/) gstin?: string;
  @IsOptional() @IsString() @MaxLength(150) gstLegalName?: string;
  @IsOptional() @IsString() @MaxLength(80) gstRegistrationType?: string;
  @IsOptional() @IsString() @MaxLength(254) businessEmail?: string;
  @IsOptional() @IsString() @MaxLength(120) website?: string;
  @IsOptional() @IsString() @MaxLength(1400000) @Matches(/^data:image\\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/) logoDataUrl?: string;
}