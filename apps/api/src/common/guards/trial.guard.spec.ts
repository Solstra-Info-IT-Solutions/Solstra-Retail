import {
  ExecutionContext,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Model } from 'mongoose';
import { TrialGuard } from './trial.guard';
import { TenantDocument } from '../../tenants/schemas/tenant.schema';

describe('TrialGuard', () => {
  let guard: TrialGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let tenants: {
    findOne: jest.Mock;
  };

  const tenantId = '507f1f77bcf86cd799439011';

  const createContext = (user?: { tenantId?: string }) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  const mockTenant = (tenant: Record<string, unknown> | null) => {
    const lean = jest.fn().mockResolvedValue(tenant);
    const select = jest.fn().mockReturnValue({ lean });

    tenants.findOne.mockReturnValue({ select });

    return { select, lean };
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };

    tenants = {
      findOne: jest.fn(),
    };

    guard = new TrialGuard(
      reflector as unknown as Reflector,
      tenants as unknown as Model<TenantDocument>,
    );
  });

  it('allows routes explicitly marked SkipTrial', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(
      guard.canActivate(createContext({ tenantId })),
    ).resolves.toBe(true);

    expect(tenants.findOne).not.toHaveBeenCalled();
  });

  it('allows requests without an authenticated tenant context', async () => {
    await expect(
      guard.canActivate(createContext()),
    ).resolves.toBe(true);

    expect(tenants.findOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid authenticated tenant ID with 401', async () => {
    await expect(
      guard.canActivate(createContext({ tenantId: 'invalid-id' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(tenants.findOne).not.toHaveBeenCalled();
  });

  it('rejects an inactive or missing tenant with 402', async () => {
    mockTenant(null);

    try {
      await guard.canActivate(createContext({ tenantId }));
      fail('Expected tenant inactive exception');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(402);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'TENANT_INACTIVE',
      });
    }
  });

  it('allows an active paid subscription even if trial has expired', async () => {
    mockTenant({
      subscriptionStatus: 'active',
      trialEndsAt: new Date(Date.now() - 86400000),
    });

    await expect(
      guard.canActivate(createContext({ tenantId })),
    ).resolves.toBe(true);
  });

  it('allows a tenant with an unexpired trial', async () => {
    mockTenant({
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() + 86400000),
    });

    await expect(
      guard.canActivate(createContext({ tenantId })),
    ).resolves.toBe(true);
  });

  it('rejects an expired trial with 402', async () => {
    mockTenant({
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() - 86400000),
    });

    try {
      await guard.canActivate(createContext({ tenantId }));
      fail('Expected trial expired exception');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(402);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'TRIAL_EXPIRED',
      });
    }
  });

  it('rejects a trial without an end date', async () => {
    mockTenant({
      subscriptionStatus: 'trial',
      trialEndsAt: null,
    });

    await expect(
      guard.canActivate(createContext({ tenantId })),
    ).rejects.toThrow(HttpException);
  });
});
