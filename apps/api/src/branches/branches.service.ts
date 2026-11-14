import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { tenantFilter } from '../common/tenant-scoped.service';
import { Branch, BranchDocument } from './schemas/branch.schema';
import { Warehouse, WarehouseDocument } from './schemas/warehouse.schema';
import { WarehouseStock } from '../inventory/schemas/warehouse-stock.schema';
import { Tenant } from '../tenants/schemas/tenant.schema';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@Injectable()
export class BranchesService {
  constructor(
    @InjectModel(Branch.name) private readonly branches: Model<BranchDocument>,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<WarehouseDocument>,
    @InjectModel(WarehouseStock.name) private readonly warehouseStocks: Model<any>,
    @InjectModel(Tenant.name) private readonly tenants: Model<any>,
  ) {}

  async createBranch(tenantId: string, dto: CreateBranchDto) {
    this.validateTenant(tenantId);
    const tenant: any = await this.tenants.findById(tenantId).select('maxBranches').lean();
    if (!tenant) throw new NotFoundException('Workspace not found');
    const branchCount = await this.branches.countDocuments(tenantFilter(tenantId, { isDeleted: false }));
    if (branchCount >= Number(tenant.maxBranches || 1)) throw new ConflictException('Workspace branch limit reached for the current subscription plan');
    const data = { ...dto, code: dto.code.trim().toUpperCase(), tenantId: new Types.ObjectId(tenantId) };
    try {
      if (data.isPrimary) await this.branches.updateMany(tenantFilter(tenantId, { isDeleted: false }), { $set: { isPrimary: false } });
      return await this.branches.create(data);
    } catch (error: any) { this.handleDuplicate(error, 'Branch code or primary branch already exists'); }
  }

  async listBranches(tenantId: string) {
    this.validateTenant(tenantId);
    const items = await this.branches.find(tenantFilter(tenantId, { isDeleted: false })).sort({ isPrimary: -1, name: 1 }).lean();
    return { items, total: items.length };
  }

  async getBranch(tenantId: string, id: string) {
    const branch = await this.findBranch(tenantId, id);
    const warehouses = await this.warehouses.find(tenantFilter(tenantId, { branchId: branch._id, isDeleted: false })).sort({ isDefault: -1, name: 1 }).lean();
    return { ...branch, warehouses };
  }

  async updateBranch(tenantId: string, id: string, dto: UpdateBranchDto) {
    const branch = await this.findBranch(tenantId, id);
    if (dto.isPrimary) await this.branches.updateMany(tenantFilter(tenantId, { _id: { $ne: branch._id }, isDeleted: false }), { $set: { isPrimary: false } });
    try {
      const updated = await this.branches.findOneAndUpdate(tenantFilter(tenantId, { _id: branch._id, isDeleted: false }), { $set: { ...dto, ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}) } }, { new: true, runValidators: true });
      if (!updated) throw new NotFoundException('Branch not found');
      return updated;
    } catch (error: any) { this.handleDuplicate(error, 'Branch code already exists'); }
  }

  async removeBranch(tenantId: string, id: string) {
    const branch = await this.findBranch(tenantId, id);
    const activeWarehouses = await this.warehouses.countDocuments(tenantFilter(tenantId, { branchId: branch._id, isDeleted: false, isActive: true }));
    if (activeWarehouses) throw new ConflictException('Deactivate or remove all active warehouses before deleting this branch');
    const branchWarehouses = await this.warehouses.find(tenantFilter(tenantId, { branchId: branch._id })).select('_id').lean();
    const warehouseIds = branchWarehouses.map((warehouse) => warehouse._id);
    const stockOnHand = warehouseIds.length ? await this.warehouseStocks.countDocuments(tenantFilter(tenantId, { warehouseId: { $in: warehouseIds }, quantity: { $gt: 0 } })) : 0;
    if (stockOnHand) throw new ConflictException('Branch cannot be archived while any of its warehouses contain stock');
    await this.branches.updateOne(tenantFilter(tenantId, { _id: branch._id }), { $set: { isDeleted: true, isActive: false, isPrimary: false, deletedAt: new Date() } });
    return { message: 'Branch archived', branchId: String(branch._id) };
  }

  async createWarehouse(tenantId: string, branchId: string, dto: CreateWarehouseDto) {
    const branch = await this.findBranch(tenantId, branchId);
    if (!branch.isActive) throw new ConflictException('Cannot add a warehouse to an inactive branch');
    try {
      if (dto.isDefault) await this.warehouses.updateMany(tenantFilter(tenantId, { branchId: branch._id, isDeleted: false }), { $set: { isDefault: false } });
      const warehouse = await this.warehouses.create({ ...dto, code: dto.code.trim().toUpperCase(), tenantId: new Types.ObjectId(tenantId), branchId: branch._id });
      return warehouse;
    } catch (error: any) { this.handleDuplicate(error, 'Warehouse code already exists in this branch'); }
  }

  async listWarehouses(tenantId: string, branchId: string) {
    const branch = await this.findBranch(tenantId, branchId);
    const items = await this.warehouses.find(tenantFilter(tenantId, { branchId: branch._id, isDeleted: false })).sort({ isDefault: -1, name: 1 }).lean();
    return { items, total: items.length };
  }

  async updateWarehouse(tenantId: string, branchId: string, id: string, dto: UpdateWarehouseDto) {
    const branch = await this.findBranch(tenantId, branchId);
    const warehouse = await this.findWarehouse(tenantId, branch._id, id);
    if (dto.isDefault) await this.warehouses.updateMany(tenantFilter(tenantId, { branchId: branch._id, _id: { $ne: warehouse._id }, isDeleted: false }), { $set: { isDefault: false } });
    try {
      const updated = await this.warehouses.findOneAndUpdate(tenantFilter(tenantId, { _id: warehouse._id, branchId: branch._id, isDeleted: false }), { $set: { ...dto, ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}) } }, { new: true, runValidators: true });
      if (!updated) throw new NotFoundException('Warehouse not found');
      return updated;
    } catch (error: any) { this.handleDuplicate(error, 'Warehouse code already exists in this branch'); }
  }

  async removeWarehouse(tenantId: string, branchId: string, id: string) {
    const branch = await this.findBranch(tenantId, branchId);
    const warehouse = await this.findWarehouse(tenantId, branch._id, id);
    const stockOnHand = await this.warehouseStocks.countDocuments(tenantFilter(tenantId, { warehouseId: warehouse._id, quantity: { $gt: 0 } }));
    if (stockOnHand) throw new ConflictException('Warehouse cannot be archived while it contains stock; transfer or adjust the stock first');
    await this.warehouses.updateOne(tenantFilter(tenantId, { _id: warehouse._id, branchId: branch._id }), { $set: { isDeleted: true, isActive: false, isDefault: false, deletedAt: new Date() } });
    return { message: 'Warehouse archived', warehouseId: String(warehouse._id) };
  }

  private validateTenant(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant context');
  }
  private async findBranch(tenantId: string, id: string): Promise<any> {
    this.validateTenant(tenantId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid branch ID');
    const branch = await this.branches.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id), isDeleted: false }));
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }
  private async findWarehouse(tenantId: string, branchId: Types.ObjectId, id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid warehouse ID');
    const warehouse = await this.warehouses.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id), branchId, isDeleted: false }));
    if (!warehouse) throw new NotFoundException('Warehouse not found in this branch');
    return warehouse;
  }
  private handleDuplicate(error: any, message: string): never {
    if (error?.code === 11000) throw new ConflictException(message);
    throw error;
  }
}