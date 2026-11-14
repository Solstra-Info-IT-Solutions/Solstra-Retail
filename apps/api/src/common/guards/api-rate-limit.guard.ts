import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

type Bucket = { count: number; resetAt: number };

@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000;
  private readonly generalLimit = 300;
  private readonly authLimit = 10;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const path = String(request.originalUrl || request.url || '');
    if (path.includes('/health')) return true;

    const now = Date.now();
    const isAuthentication = /^\/api\/v1\/auth\/(login|register|refresh)(?:\?|$)/i.test(path);
    const limit = isAuthentication ? this.authLimit : this.generalLimit;
    const identity = String(request.ip || request.socket?.remoteAddress || 'unknown').slice(0, 100);
    const routeGroup = isAuthentication ? 'AUTH' : String(request.method || 'GET').toUpperCase();
    const key = routeGroup + ':' + identity;
    let bucket = this.buckets.get(key);
    if (!bucket && this.buckets.size >= 20_000) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(bucketKey);
      }
      if (this.buckets.size >= 20_000) {
        throw new HttpException('API rate-limit capacity is temporarily exhausted. Retry shortly.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + (isAuthentication ? 15 * this.windowMs : this.windowMs) };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, limit - bucket.count);
    response.setHeader('X-RateLimit-Limit', String(limit));
    response.setHeader('X-RateLimit-Remaining', String(remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > limit) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      throw new HttpException('Request rate limit exceeded. Retry after the indicated interval.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
