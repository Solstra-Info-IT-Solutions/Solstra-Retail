import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsMongoId, IsNumber, IsOptional, IsString, Length, MaxLength, Min, ValidateNested } from 'class-validator';
export class ReceiveBatchDto {
  @IsMongoId() productId!: string;
  @IsMongoId() warehouseId!: string;
  @IsString() @Length(1, 80) batchNumber!: string;
  @IsDateString() expiresAt!: string;
  @IsOptional() @IsDateString() manufacturedAt?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost!: number;
}
export class RegisterSerialsDto {
  @IsMongoId() productId!: string;
  @IsMongoId() warehouseId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SerialNumberDto) serials!: SerialNumberDto[];
}
export class SerialNumberDto {
  @IsString() @Length(1, 100) serialNumber!: string;
}
export class CreateStocktakeDto {
  @IsMongoId() warehouseId!: string;
  @IsString() @Length(2, 250) reference!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StocktakeCountDto) lines!: StocktakeCountDto[];
}
export class StocktakeCountDto {
  @IsMongoId() productId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) countedQty!: number;
  @IsOptional() @IsString() @MaxLength(250) note?: string;
}
