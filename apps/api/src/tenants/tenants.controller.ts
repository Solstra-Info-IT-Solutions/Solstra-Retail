import { Controller, Get, Req } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Request } from 'express';
import { Model, Types } from 'mongoose';
import { Tenant, TenantDocument } from './schemas/tenant.schema';
import { SkipTrial } from '../common/decorators/skip-trial.decorator';

@Controller('tenant')
export class TenantController {
  constructor(@InjectModel(Tenant.name) private readonly tenants: Model<TenantDocument>) {}

  // Read-only workspace/trial status remains accessible after expiry.
  @SkipTrial()
  @Get('status')
  async status(@Req() req: Request & { user: any }) {
    const tenant = await this.tenants.findOne({
      _id: new Types.ObjectId(req.user.tenantId),
    }).select('name status subscriptionStatus trialStartedAt trialEndsAt').lean();
    return {
      tenant,
      trialExpired: !tenant?.trialEndsAt || Date.now() >= new Date(tenant.trialEndsAt).getTime(),
    };
  }
}
