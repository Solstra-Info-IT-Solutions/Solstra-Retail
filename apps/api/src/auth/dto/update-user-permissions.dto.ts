import { ArrayMaxSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
import { PERMISSION_CATALOG, Permission } from '../../common/decorators/permissions.decorator';

export class UpdateUserPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(PERMISSION_CATALOG.length)
  @IsIn([...PERMISSION_CATALOG], { each: true })
  permissions!: Permission[];
}
