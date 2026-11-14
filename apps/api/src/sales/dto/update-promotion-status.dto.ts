import { IsIn } from 'class-validator';

export class UpdatePromotionStatusDto {
  @IsIn(['ACTIVE', 'PAUSED'])
  status!: 'ACTIVE' | 'PAUSED';
}
