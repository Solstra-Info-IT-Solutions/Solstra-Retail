import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Always scope database filters to the authenticated tenant.
 * Never accept tenantId from client input.
 */
export function tenantFilter(
  tenantId: string,
  filter: Record<string, unknown> = {},
): Record<string, unknown> & { tenantId: Types.ObjectId } {
  if (!Types.ObjectId.isValid(tenantId)) {
    throw new UnauthorizedException('Invalid authenticated tenant context');
  }

  return {
    ...filter,
    tenantId: new Types.ObjectId(tenantId),
  };
}