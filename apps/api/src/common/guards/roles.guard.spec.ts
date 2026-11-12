import {
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const createContext = (user?: { role?: UserRole }) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };

    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows authenticated users when route has no role restriction', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(createContext({ role: 'staff' }))).toBe(true);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      ROLES_KEY,
      expect.any(Array),
    );
  });

  it('allows an owner on an owner/admin-only route', () => {
    reflector.getAllAndOverride.mockReturnValue(['owner', 'admin']);

    expect(guard.canActivate(createContext({ role: 'owner' }))).toBe(true);
  });

  it('allows an admin on an owner/admin-only route', () => {
    reflector.getAllAndOverride.mockReturnValue(['owner', 'admin']);

    expect(guard.canActivate(createContext({ role: 'admin' }))).toBe(true);
  });

  it('rejects staff on an owner/admin-only route', () => {
    reflector.getAllAndOverride.mockReturnValue(['owner', 'admin']);

    expect(() =>
      guard.canActivate(createContext({ role: 'staff' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects a request without an authenticated role on a restricted route', () => {
    reflector.getAllAndOverride.mockReturnValue(['owner', 'admin']);

    expect(() => guard.canActivate(createContext())).toThrow(
      ForbiddenException,
    );
  });
});