import { HttpException } from '@nestjs/common';
import { ApiRateLimitGuard } from './api-rate-limit.guard';

describe('ApiRateLimitGuard', () => {
  const context = (url: string, ip = '127.0.0.1') => {
    const headers: Record<string, string> = {};
    const request = { originalUrl: url, url, ip, method: 'POST', socket: { remoteAddress: ip } };
    const response = { setHeader: (key: string, value: string) => { headers[key] = value; } };
    return { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }), headers } as any;
  };

  it('allows health checks without consuming a rate-limit bucket', async () => {
    const guard = new ApiRateLimitGuard();
    expect(await guard.canActivate(context('/api/v1/health'))).toBe(true);
  });

  it('applies a strict authentication rate limit', async () => {
    const guard = new ApiRateLimitGuard();
    for (let index = 0; index < 10; index += 1) {
      expect(await guard.canActivate(context('/api/v1/auth/login'))).toBe(true);
    }
    await expect(guard.canActivate(context('/api/v1/auth/login'))).rejects.toBeInstanceOf(HttpException);
  });

  it('isolates limits by client IP and exposes retry headers', async () => {
    const guard = new ApiRateLimitGuard();
    for (let index = 0; index < 10; index += 1) await guard.canActivate(context('/api/v1/auth/login', '10.0.0.1'));
    expect(await guard.canActivate(context('/api/v1/auth/login', '10.0.0.2'))).toBe(true);
    const last = context('/api/v1/auth/login', '10.0.0.1');
    await expect(guard.canActivate(last)).rejects.toBeInstanceOf(HttpException);
    expect(last.headers['Retry-After']).toBeDefined();
    expect(last.headers['X-RateLimit-Limit']).toBe('10');
  });

  it('uses an atomic shared MongoDB counter when the database is connected', async () => {
    const collection = {
      createIndex: jest.fn().mockResolvedValue('ok'),
      findOneAndUpdate: jest.fn().mockResolvedValue({ value: { count: 2 } }),
    };
    const connection: any = { readyState: 1, db: { collection: jest.fn().mockReturnValue(collection) } };
    const guard = new ApiRateLimitGuard(connection);
    const ctx = context('/api/v1/products');
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.stringMatching(/:/) }),
      expect.objectContaining({ $inc: { count: 1 } }),
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
    expect(ctx.headers['X-RateLimit-Remaining']).toBe('298');
  });

  it('fails closed if the shared limiter database operation fails', async () => {
    const collection = {
      createIndex: jest.fn().mockResolvedValue('ok'),
      findOneAndUpdate: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const connection: any = { readyState: 1, db: { collection: jest.fn().mockReturnValue(collection) } };
    const guard = new ApiRateLimitGuard(connection);
    await expect(guard.canActivate(context('/api/v1/products'))).rejects.toThrow('Shared API rate limiting is temporarily unavailable');
  });
});
