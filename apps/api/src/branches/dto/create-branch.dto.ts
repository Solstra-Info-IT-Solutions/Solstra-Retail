import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateBranchDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,23}$/i) code!: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @Matches(/^(?:[0-9]{6})?$/) pincode?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}