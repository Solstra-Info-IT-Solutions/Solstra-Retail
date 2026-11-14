import { IsIn, IsString, Length } from 'class-validator';

export class ReviewExpenseDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsString() @Length(5, 500) reason!: string;
}
