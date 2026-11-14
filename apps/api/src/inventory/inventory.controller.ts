import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { InventoryService } from './inventory.service';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto';
import { ListInventoryMovementsDto } from './dto/list-inventory-movements.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { WarehouseInventoryService } from './warehouse-inventory.service';
import { WarehouseOpeningStockDto } from './dto/warehouse-opening-stock.dto';
import { CreateWarehouseTransferDto } from './dto/create-warehouse-transfer.dto';
import { ReplenishmentService } from './replenishment.service';
import { UpsertReplenishmentPolicyDto, ReplenishmentQueryDto } from './dto/replenishment.dto';
import { AdvancedInventoryService } from './advanced-inventory.service';
import { ReceiveBatchDto, RegisterSerialsDto, CreateStocktakeDto } from './dto/advanced-inventory.dto';
import { TransitionSerialDto } from './dto/transition-serial.dto';

type AuthenticatedRequest = Request & {
  user: {
    tenantId: string;
    userId: string;
    role: string;
  };
};

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly warehouseInventory: WarehouseInventoryService,
    private readonly replenishment: ReplenishmentService,
    private readonly advancedInventory: AdvancedInventoryService,
  ) {}

  @Roles('owner', 'admin')
  @Post('replenishment/policies')
  upsertReplenishmentPolicy(@Req() req: AuthenticatedRequest, @Body() dto: UpsertReplenishmentPolicyDto) {
    return this.replenishment.upsertPolicy(req.user.tenantId, req.user.userId, dto);
  }

  @Permissions('inventory.view')
  @Get('replenishment/policies')
  listReplenishmentPolicies(@Req() req: AuthenticatedRequest, @Query('warehouseId') warehouseId?: string) {
    return this.replenishment.listPolicies(req.user.tenantId, warehouseId);
  }

  @Permissions('inventory.view')
  @Get('replenishment/suggestions')
  replenishmentSuggestions(@Req() req: AuthenticatedRequest, @Query() query: ReplenishmentQueryDto) {
    return this.replenishment.suggestions(req.user.tenantId, query);
  }

  @Roles('owner', 'admin')
  @Post('batches')
  receiveBatch(@Req() req: AuthenticatedRequest, @Body() dto: ReceiveBatchDto) {
    return this.advancedInventory.receiveBatch(req.user.tenantId, req.user.userId, dto);
  }

  @Permissions('inventory.view')
  @Get('batches')
  listBatches(@Req() req: AuthenticatedRequest, @Query('productId') productId?: string, @Query('warehouseId') warehouseId?: string) {
    return this.advancedInventory.listBatches(req.user.tenantId, productId, warehouseId);
  }

  @Roles('owner', 'admin')
  @Post('serials')
  registerSerials(@Req() req: AuthenticatedRequest, @Body() dto: RegisterSerialsDto) {
    return this.advancedInventory.registerSerials(req.user.tenantId, req.user.userId, dto);
  }

  @Permissions('inventory.view')
  @Get('serials')
  listSerials(@Req() req: AuthenticatedRequest, @Query('productId') productId?: string, @Query('status') status?: string) {
    return this.advancedInventory.listSerials(req.user.tenantId, productId, status);
  }

  @Roles('owner', 'admin')
  @Post('serials/:id/transition')
  transitionSerial(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: TransitionSerialDto) {
    return this.advancedInventory.transitionSerial(req.user.tenantId, req.user.userId, id, dto);
  }

  @Roles('owner', 'admin')
  @Post('stocktakes')
  createStocktake(@Req() req: AuthenticatedRequest, @Body() dto: CreateStocktakeDto) {
    return this.advancedInventory.createStocktake(req.user.tenantId, req.user.userId, dto);
  }

  @Permissions('inventory.view')
  @Get('stocktakes')
  listStocktakes(@Req() req: AuthenticatedRequest) {
    return this.advancedInventory.listStocktakes(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Post('stocktakes/:id/complete')
  completeStocktake(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.advancedInventory.completeStocktake(req.user.tenantId, req.user.userId, id);
  }

  @Roles('owner', 'admin')
  @Post('products/:productId/movements')
  createMovement(
    @Req() req: AuthenticatedRequest,
    @Param('productId') productId: string,
    @Body() dto: CreateInventoryMovementDto,
  ) {
    return this.inventoryService.createMovement(
      req.user.tenantId,
      req.user.userId,
      productId,
      dto,
    );
  }

  @Roles('owner', 'admin')
  @Post('warehouses/:warehouseId/stock/opening')
  initializeWarehouseStock(@Req() req: AuthenticatedRequest, @Param('warehouseId') warehouseId: string, @Body() dto: WarehouseOpeningStockDto) {
    return this.warehouseInventory.initializeOpeningStock(req.user.tenantId, req.user.userId, warehouseId, dto);
  }

  @Roles('owner', 'admin')
  @Get('warehouse-reconciliation')
  warehouseReconciliation(@Req() req: AuthenticatedRequest) {
    return this.warehouseInventory.reconciliation(req.user.tenantId);
  }

  @Permissions('inventory.view')
  @Get('warehouses/:warehouseId/stock')
  listWarehouseStock(@Req() req: AuthenticatedRequest, @Param('warehouseId') warehouseId: string) {
    return this.warehouseInventory.listWarehouseStock(req.user.tenantId, warehouseId);
  }

  @Roles('owner', 'admin')
  @Post('transfers')
  createWarehouseTransfer(@Req() req: AuthenticatedRequest, @Body() dto: CreateWarehouseTransferDto) {
    return this.warehouseInventory.createTransfer(req.user.tenantId, req.user.userId, dto);
  }

  @Permissions('inventory.view')
  @Get('transfers')
  listWarehouseTransfers(@Req() req: AuthenticatedRequest, @Query('page') page = '1', @Query('limit') limit = '20') {
    return this.warehouseInventory.listTransfers(req.user.tenantId, Math.max(1, Number(page) || 1), Math.min(100, Math.max(1, Number(limit) || 20)));
  }

  @Permissions('inventory.view')
  @Get('movements')
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListInventoryMovementsDto,
  ) {
    return this.inventoryService.findAll(
      req.user.tenantId,
      query,
    );
  }
}

