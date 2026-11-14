import { HttpException } from '@nestjs/common';
import { ApiRateLimitGuard } from './api-rate-limit.guard';

describe('ApiRateLimitGuard', () => {
  const context = (url: string, ip = '127.0.0.1') => {
    const headers: Record<string, string> = {};
    const request = { originalUrl: url, url, ip, method: 'POST', socket: { remoteAddress: ip } };
    const response = { setHeader: (key: string, value: string) => { headers[key] = value; } };
    return { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }), headers } as any;
  };

  it('allows health checks without consuming a rate-limit bucket', () => {
    const guard = new ApiRateLimitGuard();
    expect(guard.canActivate(context('/api/v1/health'))).toBe(true);
  });

  it('applies a strict authentication rate limit', () => {
    const guard = new ApiRateLimitGuard();
    for (let index = 0; index < 10; index += 1) {
      expect(guard.canActivate(context('/api/v1/auth/login'))).toBe(true);
    }
    expect(() => guard.canActivate(context('/api/v1/auth/login'))).toThrow(HttpException);
  });

  it('isolates limits by client IP and exposes retry headers', () => {
    const guard = new ApiRateLimitGuard();
    for (let index = 0; index < 10; index += 1) guard.canActivate(context('/api/v1/auth/login', '10.0.0.1'));
    expect(guard.canActivate(context('/api/v1/auth/login', '10.0.0.2'))).toBe(true);
    const last = context('/api/v1/auth/login', '10.0.0.1');
    expect(() => guard.canActivate(last)).toThrow(HttpException);
    expect(last.headers['Retry-After']).toBeDefined();
    expect(last.headers['X-RateLimit-Limit']).toBe('10');
  });
});
