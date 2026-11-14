import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

export const PERMISSION_CATALOG = [
  'dashboard.view',
  'products.view',
  'customers.view',
  'categories.view',
  'suppliers.view',
  'purchases.view',
  'sales.view',
  'sales.create',
  'sales.payments.create',
  'inventory.view',
  'reports.view',
  'expenses.view',
  'expenses.create',
] as const;

export type Permission = (typeof PERMISSION_CATALOG)[number];

export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
