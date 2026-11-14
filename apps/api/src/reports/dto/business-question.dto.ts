import { IsString, Length } from 'class-validator';

export class BusinessQuestionDto {
  @IsString()
  @Length(3, 300)
  question!: string;
}
