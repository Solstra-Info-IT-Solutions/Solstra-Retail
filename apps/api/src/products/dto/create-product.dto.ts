import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @Length(2, 150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;


  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchasePrice!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sellingPrice!: number;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  mrp!: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 5, 12, 18, 28])
  gstRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQty?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  warrantyDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  warrantyTerms?: string;
}





