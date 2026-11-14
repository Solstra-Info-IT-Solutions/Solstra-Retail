import { Type } from 'class-transformer';
import { IsMongoId, IsOptional, IsString, IsIn, IsInt, Length, MaxLength, Min } from 'class-validator';

export class CreateWarrantyClaimDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @Length(5, 1000)
  issueDescription!: string;
}

export class ReviewWarrantyClaimDto {
  @IsIn(['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'])
  status!: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'RESOLVED';

  @IsString()
  @Length(5, 500)
  reason!: string;

  @IsOptional()
  @IsIn(['REPAIR', 'EXCHANGE', 'REFUND'])
  resolutionType?: 'REPAIR' | 'EXCHANGE' | 'REFUND';

  @IsOptional()
  @IsMongoId()
  creditNoteId?: string;

  @IsOptional()
  @IsMongoId()
  replacementInvoiceId?: string;
}
