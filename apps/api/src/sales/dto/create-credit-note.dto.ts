import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateCreditNoteItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lineIndex!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @IsOptional()
  @IsBoolean()
  restock?: boolean;
}

export class CreateCreditNoteDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateCreditNoteItemDto)
  items!: CreateCreditNoteItemDto[];

  @IsString()
  @MinLength(3)
  @MaxLength(250)
  reason!: string;
}



