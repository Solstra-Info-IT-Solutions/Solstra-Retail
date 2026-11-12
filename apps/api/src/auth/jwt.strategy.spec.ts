import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { JwtStrategy } from './jwt.strategy';
import { UserDocument } from './schemas/user.schema';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let users: {
    findOne: jest.Mock;
  };

  const userId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();

  const makePayload = (overrides: Record<string, unknown> = {}) => ({
    sub: userId.toString(),
    tenantId: tenantId.toString(),
    role: 'owner',
    ...overrides,
  });

  beforeEach(() => {
    users = {
      findOne: jest.fn(),
    };

    const config = {
      getOrThrow: jest.fn().mockReturnValue(
        'test-jwt-secret-at-least-32-characters-long',
      ),
    };

    strategy = new JwtStrategy(
      config as unknown as ConfigService,
      users as unknown as Model<UserDocument>,
    );
  });

  function mockUser(user: Record<string, unknown> | null) {
    const lean = jest.fn().mockResolvedValue(user);
    const select = jest.fn().mockReturnValue({ lean });

    users.findOne.mockReturnValue({ select });

    return { select, lean };
  }

  it('rejects an invalid user ID', async () => {
    await expect(
      strategy.validate(makePayload({ sub: 'invalid-user-id' }) as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid tenant ID', async () => {
    await expect(
      strategy.validate(makePayload({ tenantId: 'invalid-tenant-id' }) as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('rejects missing or inactive users', async () => {
    mockUser(null);

    await expect(
      strategy.validate(makePayload() as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(users.findOne).toHaveBeenCalledWith({
      _id: userId,
      tenantId,
      isActive: true,
    });
  });

  it('rejects a token when its tenant does not match the user tenant', async () => {
    const anotherTenantId = new Types.ObjectId();
    mockUser(null);

    await expect(
      strategy.validate(
        makePayload({ tenantId: anotherTenantId.toString() }) as any,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(users.findOne).toHaveBeenCalledWith({
      _id: userId,
      tenantId: anotherTenantId,
      isActive: true,
    });
  });

  it('uses the database role instead of the JWT payload role', async () => {
    const databaseUser = {
      _id: userId,
      tenantId,
      role: 'staff',
      name: 'Test Staff',
      email: 'staff@example.com',
    };

    mockUser(databaseUser);

    const result = await strategy.validate(
      makePayload({ role: 'owner' }) as any,
    );

    expect(result).toEqual({
      userId: userId.toString(),
      tenantId: tenantId.toString(),
      role: 'staff',
      name: 'Test Staff',
      email: 'staff@example.com',
    });
  });
});
