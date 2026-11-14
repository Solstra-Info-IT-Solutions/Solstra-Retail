import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<any>();
    const method = String(request.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next.handle();

    const route = String(request.originalUrl || request.url || '').split('?')[0];
    if (/\/auth\/(login|register)(?:\/|$)/i.test(route)) return next.handle();

    const user = request.user;
    if (!user?.tenantId || !user?.userId) return next.handle();

    const resourceId = request.params?.id || request.params?.productId ||
      request.params?.branchId || request.params?.warehouseId || '';
    const resource = context.getClass().name.replace(/Controller$/, '') || 'Unknown';
    return next.handle().pipe(tap(() => {
      void this.audit.record({
        tenantId: String(user.tenantId),
        actorId: String(user.userId),
        actorRole: String(user.role || 'unknown'),
        action: method,
        resource,
        resourceId: String(resourceId),
        route,
        ipAddress: String(request.ip || ''),
        userAgent: String(request.headers?.['user-agent'] || ''),
      }).catch(() => undefined);
    }));
  }
}
