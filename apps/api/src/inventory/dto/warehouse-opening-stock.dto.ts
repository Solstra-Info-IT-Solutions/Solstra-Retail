import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsString, Min, MinLength, MaxLength } from 'class-validator';

export class WarehouseOpeningStockDto {
  @IsMongoId()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;

  @IsString()
  @MinLength(5)
  @MaxLength(250)
  reason!: string;
}
