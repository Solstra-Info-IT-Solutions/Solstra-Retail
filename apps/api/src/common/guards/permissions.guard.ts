import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, Permission } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as
      | { role?: string; permissions?: string[] }
      | undefined;
    if (user?.role === 'owner' || user?.role === 'admin') return true;

    const granted = new Set(user?.permissions || []);
    if (!required.every((permission) => granted.has(permission))) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'INSUFFICIENT_PERMISSION',
        message: 'Your account does not have permission to perform this action.',
        requiredPermissions: required,
      });
    }
    return true;
  }
}
