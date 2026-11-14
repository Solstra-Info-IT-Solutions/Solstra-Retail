import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class HistoricalTransactionImportDto {
  @IsIn(['SALES', 'PURCHASES']) entity!: 'SALES' | 'PURCHASES';
  @IsString() @Length(2, 80) sourceSystem!: string;
  @IsString() @Length(8, 80) runKey!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsObject({ each: true }) rows!: Array<Record<string, unknown>>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000000) expectedDocumentCount?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) expectedTotalAmount?: number;
}
