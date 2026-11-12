import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'required_roles';

export type UserRole = 'owner' | 'admin' | 'staff';

export const Roles = (...roles: UserRole[]) =>
  SetMetadata(ROLES_KEY, roles);
