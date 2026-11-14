import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { createHash } from 'crypto';

type Bucket = { count: number; resetAt: number };

@Injectable()
export class ApiRateLimitGuard implements CanActivate, OnModuleInit {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000;
  private readonly generalLimit = 300;
  private readonly authLimit = 10;
  private indexReady = false;

  constructor(@InjectConnection() private readonly connection?: Connection) {}

  async onModuleInit() {
    if (this.connection?.readyState === 1 && this.connection.db) {
      await this.ensureIndex();
    }
  }

  private async ensureIndex() {
    if (this.indexReady || !this.connection?.db) return;
    await this.connection.db.collection('api_rate_limit_buckets').createIndex(
      { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'api_rate_limit_expiry' },
    );
    this.indexReady = true;
  }

  private enforce(count: number, limit: number, resetAt: number, response: any, now: number) {
    const remaining = Math.max(0, limit - count);
    response.setHeader('X-RateLimit-Limit', String(limit));
    response.setHeader('X-RateLimit-Remaining', String(remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
    if (count > limit) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
      throw new HttpException('Request rate limit exceeded. Retry after the indicated interval.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private enforceLocal(key: string, limit: number, duration: number, response: any, now: number) {
    let bucket = this.buckets.get(key);
    if (!bucket && this.buckets.size >= 20_000) {
      for (const [bucketKey, value] of this.buckets) if (value.resetAt <= now) this.buckets.delete(bucketKey);
      if (this.buckets.size >= 20_000) {
        throw new HttpException('API rate-limit capacity is temporarily exhausted. Retry shortly.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + duration };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return this.enforce(bucket.count, limit, bucket.resetAt, response, now);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const path = String(request.originalUrl || request.url || '');
    if (path.includes('/health')) return true;

    const now = Date.now();
    const isAuthentication = /^\/api\/v1\/auth\/(login|register|refresh)(?:\?|$)/i.test(path);
    const limit = isAuthentication ? this.authLimit : this.generalLimit;
    const duration = isAuthentication ? 15 * this.windowMs : this.windowMs;
    const identity = String(request.ip || request.socket?.remoteAddress || 'unknown').slice(0, 100);
    const routeGroup = isAuthentication ? 'AUTH' : String(request.method || 'GET').toUpperCase();
    const key = routeGroup + ':' + identity;

    if (!this.connection || this.connection.readyState !== 1 || !this.connection.db) {
      return this.enforceLocal(key, limit, duration, response, now);
    }

    try {
      await this.ensureIndex();
      const windowStart = Math.floor(now / duration) * duration;
      const resetAt = windowStart + duration;
      const id = createHash('sha256').update(key).digest('hex') + ':' + windowStart;
      const collection = this.connection.db.collection('api_rate_limit_buckets');
      const result: any = await collection.findOneAndUpdate(
        { _id: id },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetAt + 60_000), resetAt: new Date(resetAt) } },
        { upsert: true, returnDocument: 'after' },
      );
      const bucket: any = result?.value ?? result;
      if (!bucket || !Number.isFinite(Number(bucket.count))) {
        throw new Error('Rate-limit bucket could not be read after atomic increment');
      }
      return this.enforce(Number(bucket.count), limit, resetAt, response, now);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Shared API rate limiting is temporarily unavailable. Retry shortly.');
    }
  }
}
