import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateExpenseDto {
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(60) category!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100000000) amount!: number;
  @IsOptional() @IsDateString() expenseDate?: string;
  @IsOptional() @IsString() @MaxLength(120) payee?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) attachmentUrl?: string;
}
