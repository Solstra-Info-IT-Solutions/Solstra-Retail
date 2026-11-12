import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional,
  IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class JournalLineDto {
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

export class CreateJournalEntryDto {
  @IsDateString()
  postingDate!: string;

  @IsString()
  @MaxLength(500)
  narration!: string;

  @IsOptional()
  @IsIn(['MANUAL'])
  sourceType?: 'MANUAL';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceId?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}
