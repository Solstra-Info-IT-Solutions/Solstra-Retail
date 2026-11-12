import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { tenantFilter } from './tenant-scoped.service';

describe('tenantFilter', () => {
  const tenantA = '507f1f77bcf86cd799439011';
  const tenantB = '507f191e810c19729de860ea';

  it('adds the authenticated tenant ID to the filter', () => {
    const result = tenantFilter(tenantA, { name: 'Product A' });

    expect(result.tenantId).toEqual(new Types.ObjectId(tenantA));
    expect(result.name).toBe('Product A');
  });

  it('prevents a supplied filter from overriding tenant ID', () => {
    const result = tenantFilter(tenantA, {
      tenantId: new Types.ObjectId(tenantB),
    });

    expect(result.tenantId).toEqual(new Types.ObjectId(tenantA));
    expect(result.tenantId).not.toEqual(new Types.ObjectId(tenantB));
  });

  it('supports an empty additional filter', () => {
    const result = tenantFilter(tenantA);

    expect(result).toEqual({
      tenantId: new Types.ObjectId(tenantA),
    });
  });

  it('rejects an invalid authenticated tenant ID', () => {
    expect(() => tenantFilter('invalid-id')).toThrow(
      UnauthorizedException,
    );
  });
});