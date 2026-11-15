import { IsString, Length, Matches } from 'class-validator';

export class RequestPasswordChangeDto {
  @IsString() @Length(12, 72)
  currentPassword!: string;

  @IsString() @Length(12, 72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).+$/, {
    message: 'New password must include lowercase, uppercase and a number',
  })
  newPassword!: string;
}
