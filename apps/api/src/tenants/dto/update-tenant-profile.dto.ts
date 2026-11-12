import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateTenantProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  businessName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
  gstin?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)$/)
  stateCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  district?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{6}$/)
  pincode?: string;
}