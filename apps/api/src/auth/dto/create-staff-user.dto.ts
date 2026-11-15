import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PERMISSION_CATALOG } from '../../common/decorators/permissions.decorator';

export class CreateStaffUserDto {
  @IsString() @Length(2, 80) name!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(12, 72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, { message: 'Password must include lowercase, uppercase and a number' })
  password!: string;
  @IsOptional() @IsString() @MaxLength(80) designation?: string;
  @IsOptional() @IsString() @Matches(/^[6-9][0-9]{9}$/) phone?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsIn([...PERMISSION_CATALOG], { each: true }) permissions?: string[];
}