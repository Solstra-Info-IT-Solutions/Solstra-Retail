import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, IsBoolean, IsNumber, Min, Max } from 'class-validator';

export class UpsertReplenishmentPolicyDto {
  @IsMongoId()
  productId!: string;

  @IsMongoId()
  warehouseId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reorderPoint!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  targetStock!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  safetyStock!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  minimumOrderQty!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  packSize!: number;

  @IsOptional()
  @IsMongoId()
  preferredSupplierId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReplenishmentQueryDto {
  @IsOptional()
  @IsMongoId()
  warehouseId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  lookbackDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  forecastDays?: number;
}
