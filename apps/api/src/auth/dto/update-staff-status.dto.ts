import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
export class UpdateStaffStatusDto {
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}