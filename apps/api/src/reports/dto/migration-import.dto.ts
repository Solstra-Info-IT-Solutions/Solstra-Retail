import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsString, Length, MaxLength } from 'class-validator';

export class MigrationImportDto {
  @IsIn(['customers', 'suppliers']) entity!: 'customers' | 'suppliers';
  @IsString() @Length(8, 80) runKey!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsObject({ each: true }) rows!: Array<Record<string, unknown>>;
}
