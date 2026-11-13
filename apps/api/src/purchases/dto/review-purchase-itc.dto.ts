import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class ReviewPurchaseItcDto {
  @IsIn(['PENDING_DOCUMENTS', 'ELIGIBLE', 'INELIGIBLE', 'DISPUTED'])
  status!: 'PENDING_DOCUMENTS' | 'ELIGIBLE' | 'INELIGIBLE' | 'DISPUTED';

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
