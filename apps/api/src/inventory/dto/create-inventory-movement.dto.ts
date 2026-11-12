import {
  IsIn,
  IsInt,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateInventoryMovementDto {
  @IsIn(['IN', 'OUT', 'ADJUSTMENT'])
  type!: 'IN' | 'OUT' | 'ADJUSTMENT';

  @Transform(({ value }) =>
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
      ? Number.NaN
      : Number(value),
  )
  @IsInt()
  @Min(0)
  quantity!: number;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 250)
  reason!: string;
}
