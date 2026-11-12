import { IsString, Length } from 'class-validator';

export class CancelSaleDto {
  @IsString()
  @Length(3, 250)
  reason!: string;
}
