import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

export class AdjustLoyaltyPointsDto {
  @Type(() => Number)
  @IsInt()
  @Min(-1000000)
  @Max(1000000)
  pointsDelta!: number;

  @IsString()
  @Length(5, 250)
  reason!: string;
}
