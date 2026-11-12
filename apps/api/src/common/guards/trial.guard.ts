import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SKIP_TRIAL_KEY } from '../decorators/skip-trial.decorator';
import { Tenant, TenantDocument } from '../../tenants/schemas/tenant.schema';

@Injectable()
export class TrialGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(Tenant.name)
    private readonly tenants: Model<TenantDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_TRIAL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { tenantId?: string } | undefined;

    // Public routes have no authenticated user.
    if (!user?.tenantId) return true;

    if (!Types.ObjectId.isValid(user.tenantId)) {
      throw new UnauthorizedException('Invalid authenticated tenant context');
    }

    const tenant = await this.tenants
      .findOne({
        _id: new Types.ObjectId(user.tenantId),
        status: 'active',
      })
      .select('trialStartedAt trialEndsAt subscriptionStatus')
      .lean();

    if (!tenant) {
      throw new HttpException(
        {
          code: 'TENANT_INACTIVE',
          message: 'This workspace is inactive. Contact support.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // Active paid subscriptions bypass trial expiry.
    if (tenant.subscriptionStatus === 'active') return true;

    const now = Date.now();

    if (
      !tenant.trialEndsAt ||
      now >= new Date(tenant.trialEndsAt).getTime()
    ) {
      throw new HttpException(
        {
          code: 'TRIAL_EXPIRED',
          message:
            'Your 7-day Solstra Retail trial has expired. Choose a plan to continue.',
          trialEndsAt: tenant.trialEndsAt ?? null,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }
}