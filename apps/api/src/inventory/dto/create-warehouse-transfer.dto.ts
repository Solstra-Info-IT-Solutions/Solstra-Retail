import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsString, Min, MinLength, MaxLength } from 'class-validator';

export class CreateWarehouseTransferDto {
  @IsMongoId()
  productId!: string;

  @IsMongoId()
  sourceWarehouseId!: string;

  @IsMongoId()
  destinationWarehouseId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @MinLength(5)
  @MaxLength(250)
  reason!: string;
}
