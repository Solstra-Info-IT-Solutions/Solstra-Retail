import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateRecurringExpenseDto {
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(60) category!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100000000) amount!: number;
  @IsOptional() @IsString() @MaxLength(120) payee?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY']) frequency!: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  @IsDateString() nextRunAt!: string;
  @IsOptional() @IsDateString() endDate?: string;
}
