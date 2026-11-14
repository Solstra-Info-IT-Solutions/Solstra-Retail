import { IsIn, IsMongoId, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class TransitionSerialDto {
  @IsIn(['IN_STOCK', 'SOLD', 'RETURNED', 'DAMAGED'])
  status!: 'IN_STOCK' | 'SOLD' | 'RETURNED' | 'DAMAGED';

  @IsOptional()
  @IsMongoId()
  saleInvoiceId?: string;

  @IsString()
  @Length(5, 500)
  reason!: string;
}
