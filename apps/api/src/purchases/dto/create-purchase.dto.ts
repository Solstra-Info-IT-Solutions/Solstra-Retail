import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsMongoId, IsNotEmpty,
  IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';

export class CreatePurchaseItemDto {
  @IsMongoId()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost!: number;

  @Type(() => Number)
  @IsIn([0, 5, 12, 18, 28])
  gstRate!: number;
}

export class CreatePurchaseDto {
  @IsMongoId()
  supplierId!: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  supplierInvoiceNumber!: string;

  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  supplierInvoiceDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)$/)
  placeOfSupplyStateCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  items!: CreatePurchaseItemDto[];
}

