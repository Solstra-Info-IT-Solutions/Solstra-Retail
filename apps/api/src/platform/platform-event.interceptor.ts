import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PlatformService } from './platform.service';

@Injectable()
export class PlatformEventInterceptor implements NestInterceptor {
  constructor(private readonly platform: PlatformService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<any>();
    const method = String(request.method || '').toUpperCase();
    if (method !== 'POST') return next.handle();
    const route = String(request.originalUrl || request.url || '').split('?')[0];
    const user = request.user;
    if (!user?.tenantId || !user?.userId) return next.handle();
    let eventType: string | null = null;
    if (/\/api\/v1\/sales\/?$/.test(route)) eventType = 'SALE_CREATED';
    else if (/\/api\/v1\/expenses\/?$/.test(route)) eventType = 'EXPENSE_PENDING_APPROVAL';
    if (!eventType) return next.handle();
    return next.handle().pipe(tap((response) => {
      const sourceId = String(response?._id || response?.id || request.body?.idempotencyKey || `${route}:${Date.now()}`);
      const payload = {
        sourceId,
        actorId: String(user.userId),
        route,
        amount: Number(response?.grandTotal || response?.amount || 0),
        status: String(response?.approvalStatus || response?.status || ''),
      };
      if (eventType === 'EXPENSE_PENDING_APPROVAL' && !['PENDING_APPROVAL', 'PENDING'].includes(payload.status)) return;
      void this.platform.executeEvent(String(user.tenantId), eventType!, sourceId, payload).catch(() => undefined);
      void this.platform.queueEventForIntegrations(String(user.tenantId), eventType!, sourceId, payload).catch(() => undefined);
      if (eventType === 'SALE_CREATED') {
        const productIds = Array.isArray(request.body?.items) ? request.body.items.map((item: any) => String(item.productId)) : [];
        void this.platform.evaluateLowStock(String(user.tenantId), productIds, sourceId).catch(() => undefined);
      }
      if (/\/api\/v1\/inventory\/products\/[^/]+\/movements\/?$/.test(route)) {
        const productId = String(request.params?.productId || '');
        void this.platform.evaluateLowStock(String(user.tenantId), [productId], sourceId).catch(() => undefined);
      }
    }));
  }
}
