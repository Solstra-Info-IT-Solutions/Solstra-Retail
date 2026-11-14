import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Roles('owner', 'admin')
  @Post()
  createBranch(@Req() req: any, @Body() dto: CreateBranchDto) { return this.branches.createBranch(req.user.tenantId, dto); }

  @Get()
  listBranches(@Req() req: any) { return this.branches.listBranches(req.user.tenantId); }

  @Get(':id')
  getBranch(@Req() req: any, @Param('id') id: string) { return this.branches.getBranch(req.user.tenantId, id); }

  @Roles('owner', 'admin')
  @Patch(':id')
  updateBranch(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateBranchDto) { return this.branches.updateBranch(req.user.tenantId, id, dto); }

  @Roles('owner', 'admin')
  @Delete(':id')
  removeBranch(@Req() req: any, @Param('id') id: string) { return this.branches.removeBranch(req.user.tenantId, id); }

  @Roles('owner', 'admin')
  @Post(':branchId/warehouses')
  createWarehouse(@Req() req: any, @Param('branchId') branchId: string, @Body() dto: CreateWarehouseDto) { return this.branches.createWarehouse(req.user.tenantId, branchId, dto); }

  @Get(':branchId/warehouses')
  listWarehouses(@Req() req: any, @Param('branchId') branchId: string) { return this.branches.listWarehouses(req.user.tenantId, branchId); }

  @Roles('owner', 'admin')
  @Patch(':branchId/warehouses/:id')
  updateWarehouse(@Req() req: any, @Param('branchId') branchId: string, @Param('id') id: string, @Body() dto: UpdateWarehouseDto) { return this.branches.updateWarehouse(req.user.tenantId, branchId, id, dto); }

  @Roles('owner', 'admin')
  @Delete(':branchId/warehouses/:id')
  removeWarehouse(@Req() req: any, @Param('branchId') branchId: string, @Param('id') id: string) { return this.branches.removeWarehouse(req.user.tenantId, branchId, id); }
}