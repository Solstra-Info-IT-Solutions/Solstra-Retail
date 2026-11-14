import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  const context = (user?: any) => ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new PermissionsGuard(reflector as unknown as Reflector);
  });

  it('allows routes without permission metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(context({ role: 'staff' }))).toBe(true);
  });

  it('allows owners and admins without individual assignments', () => {
    reflector.getAllAndOverride.mockReturnValue(['sales.create']);
    expect(guard.canActivate(context({ role: 'owner' }))).toBe(true);
    expect(guard.canActivate(context({ role: 'admin' }))).toBe(true);
  });

  it('allows staff with the required permission', () => {
    reflector.getAllAndOverride.mockReturnValue(['sales.create']);
    expect(guard.canActivate(context({ role: 'staff', permissions: ['sales.create'] }))).toBe(true);
  });

  it('rejects staff without the required permission', () => {
    reflector.getAllAndOverride.mockReturnValue(['sales.create']);
    expect(() => guard.canActivate(context({ role: 'staff', permissions: ['sales.view'] })))
      .toThrow(ForbiddenException);
  });

  it('requires every permission declared on a route', () => {
    reflector.getAllAndOverride.mockReturnValue(['sales.view', 'reports.view']);
    expect(() => guard.canActivate(context({ role: 'staff', permissions: ['sales.view'] })))
      .toThrow(ForbiddenException);
  });

  it('rejects missing authenticated users on permission-protected routes', () => {
    reflector.getAllAndOverride.mockReturnValue(['sales.view']);
    expect(() => guard.canActivate(context())).toThrow(ForbiddenException);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(PERMISSIONS_KEY, expect.any(Array));
  });
});
