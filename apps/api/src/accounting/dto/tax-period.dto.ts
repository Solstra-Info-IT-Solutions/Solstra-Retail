import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class TaxPeriodDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
