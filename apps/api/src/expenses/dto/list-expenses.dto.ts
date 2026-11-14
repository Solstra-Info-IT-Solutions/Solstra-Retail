import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListExpensesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['UNPAID', 'PARTIALLY_PAID', 'PAID']) status?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
