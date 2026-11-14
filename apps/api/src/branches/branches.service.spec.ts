import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BranchesService } from './branches.service';

describe('BranchesService', () => {
  const tenantId = '507f1f77bcf86cd799439011';
  const branches = { findOne: jest.fn(), create: jest.fn(), updateMany: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() };
  const warehouses = { findOne: jest.fn(), create: jest.fn(), countDocuments: jest.fn(), find: jest.fn(), updateMany: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() };
  let service: BranchesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BranchesService(branches as any, warehouses as any);
  });

  it('rejects invalid tenant context before accessing branch data', async () => {
    await expect(service.listBranches('invalid')).rejects.toBeInstanceOf(BadRequestException);
    expect(branches.find).not.toHaveBeenCalled();
  });

  it('rejects malformed branch identifiers before database access', async () => {
    await expect(service.getBranch(tenantId, 'invalid')).rejects.toBeInstanceOf(BadRequestException);
    expect(branches.findOne).not.toHaveBeenCalled();
  });

  it('scopes branch lookup to the authenticated tenant', async () => {
    branches.findOne.mockResolvedValue(null);
    await expect(service.getBranch(tenantId, '507f1f77bcf86cd799439012')).rejects.toBeInstanceOf(NotFoundException);
    const filter = branches.findOne.mock.calls[0][0];
    expect(String(filter.tenantId)).toBe(tenantId);
  });
});
