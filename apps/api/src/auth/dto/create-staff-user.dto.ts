import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreateStaffUserDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(12, 72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must include lowercase, uppercase and a number',
  })
  password!: string;
}
