import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class RedeemLoyaltyPointsDto {
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1000000)
  points!: number;
}
