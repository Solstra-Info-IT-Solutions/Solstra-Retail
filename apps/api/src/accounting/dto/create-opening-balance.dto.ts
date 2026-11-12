import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OpeningBalanceLineDto {
  @IsString()
  accountId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class CreateOpeningBalanceDto {
  @IsDateString()
  postingDate!: string;

  @IsString()
  @MaxLength(500)
  narration!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceLineDto)
  lines!: OpeningBalanceLineDto[];
}
