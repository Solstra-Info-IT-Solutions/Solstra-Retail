import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9][0-9\s-]{6,19}$/)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i)
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)$/)
  stateCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[1-9][0-9]{5}$/)
  @MaxLength(10)
  pincode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

