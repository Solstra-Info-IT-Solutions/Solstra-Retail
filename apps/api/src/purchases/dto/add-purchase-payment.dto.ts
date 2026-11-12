import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class AddPurchasePaymentDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsIn(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'])
  method!: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}
