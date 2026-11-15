import { IsIn, IsString, Length } from 'class-validator';

export class ReviewApprovalDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsString() @Length(8, 500) reason!: string;
}
