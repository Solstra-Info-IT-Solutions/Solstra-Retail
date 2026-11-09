import { Types } from 'mongoose';

/**
 * Use this helper when constructing filters for tenant-owned collections.
 * Never accept tenantId from client input. Pass req.user.tenantId only.
 */
export function tenantFilter(tenantId: string, filter: Record<string, unknown> = {}) {
  if (!Types.ObjectId.isValid(tenantId)) throw new Error('Invalid authenticated tenant context');
  return { ...filter, tenantId: new Types.ObjectId(tenantId) };
}

/**
 * Example:
 * const product = await this.products.findOne(
 *   tenantFilter(req.user.tenantId, { _id: productId })
 * );
 *
 * For branch-scoped resources add branchId from a server-validated membership,
 * not from an untrusted body field.
 */
