import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsMongoId, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
export class CreatePriceRuleDto {
  @IsString() @Length(2, 60) name!: string;
  @IsIn(['PRODUCT', 'CATEGORY']) appliesTo!: 'PRODUCT' | 'CATEGORY';
  @IsOptional() @IsMongoId() productId?: string;
  @IsOptional() @IsString() @Length(1, 100) category?: string;
  @IsIn(['FIXED_PRICE', 'PERCENT_OFF', 'AMOUNT_OFF']) ruleType!: 'FIXED_PRICE' | 'PERCENT_OFF' | 'AMOUNT_OFF';
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) value!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) minimumQuantity?: number;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priority?: number;
}
