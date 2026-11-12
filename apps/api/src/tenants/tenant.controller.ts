import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Req,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Request } from 'express';
import { Model, Types } from 'mongoose';

import { Tenant, TenantDocument } from './schemas/tenant.schema';
import { SkipTrial } from '../common/decorators/skip-trial.decorator';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';
import { Roles } from '../common/decorators/roles.decorator';

type AuthenticatedRequest = Request & {
  user: {
    tenantId: string;
    userId: string;
    role: string;
  };
};

@Controller('tenant')
export class TenantController {
  constructor(
    @InjectModel(Tenant.name)
    private readonly tenants: Model<TenantDocument>,
  ) {}

  // Workspace and trial status remain accessible after trial expiry.
  @SkipTrial()
  @Get('status')
  async status(@Req() req: AuthenticatedRequest) {
    const tenant = await this.tenants
      .findById(new Types.ObjectId(req.user.tenantId))
      .select(
        'name status subscriptionStatus trialStartedAt trialEndsAt',
      )
      .lean();

    return {
      tenant,
      trialExpired:
        !tenant?.trialEndsAt ||
        Date.now() >= new Date(tenant.trialEndsAt).getTime(),
    };
  }

  // Read the authenticated workspace's business profile.
  @Get('profile')
  async getProfile(@Req() req: AuthenticatedRequest) {
    const tenant = await this.tenants
      .findById(new Types.ObjectId(req.user.tenantId))
      .select(
        'name gstin stateCode addressLine1 addressLine2 city district pincode',
      )
      .lean();

    if (!tenant) {
      throw new NotFoundException('Workspace not found');
    }

    return tenant;
  }

  // Update only the authenticated workspace's business profile.
  @Roles('owner', 'admin')
  @Patch('profile')
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateTenantProfileDto,
  ) {
    if (!Types.ObjectId.isValid(req.user.tenantId)) {
      throw new BadRequestException('Invalid workspace');
    }

    const tenantId = new Types.ObjectId(req.user.tenantId);

    const existing = await this.tenants
      .findById(tenantId)
      .select('gstin stateCode')
      .lean();

    if (!existing) {
      throw new NotFoundException('Workspace not found');
    }

    const gstin =
      dto.gstin === undefined
        ? existing.gstin
        : dto.gstin
          ? dto.gstin.trim().toUpperCase()
          : null;

    const stateCode =
      dto.stateCode === undefined
        ? existing.stateCode
        : dto.stateCode;

    if (gstin && !stateCode) {
      throw new BadRequestException(
        'Set the business state code before adding GSTIN',
      );
    }

    if (gstin && stateCode && gstin.substring(0, 2) !== stateCode) {
      throw new BadRequestException(
        'GSTIN state code must match the business state code',
      );
    }

    const updates: Record<string, unknown> = {
      ...dto,
    };

    delete updates.businessName;

    if (dto.businessName !== undefined) {
      updates.name = dto.businessName.trim();
    }

    if (dto.gstin !== undefined) {
      updates.gstin = gstin;
    }

    if (dto.stateCode !== undefined) {
      updates.stateCode = stateCode;
    }

    const updated = await this.tenants
      .findOneAndUpdate(
        { _id: tenantId },
        { $set: updates },
        {
          new: true,
          runValidators: true,
        },
      )
      .select(
        'name gstin stateCode addressLine1 addressLine2 city district pincode',
      )
      .lean();

    if (!updated) {
      throw new NotFoundException('Workspace not found');
    }

    return updated;
  }
}

