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
import { WarehouseInventoryService } from './warehouse-inventory.service';
import { WarehouseOpeningStockDto } from './dto/warehouse-opening-stock.dto';
import { CreateWarehouseTransferDto } from './dto/create-warehouse-transfer.dto';

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
  ) {}

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

  @Get('warehouses/:warehouseId/stock')
  listWarehouseStock(@Req() req: AuthenticatedRequest, @Param('warehouseId') warehouseId: string) {
    return this.warehouseInventory.listWarehouseStock(req.user.tenantId, warehouseId);
  }

  @Roles('owner', 'admin')
  @Post('transfers')
  createWarehouseTransfer(@Req() req: AuthenticatedRequest, @Body() dto: CreateWarehouseTransferDto) {
    return this.warehouseInventory.createTransfer(req.user.tenantId, req.user.userId, dto);
  }

  @Get('transfers')
  listWarehouseTransfers(@Req() req: AuthenticatedRequest, @Query('page') page = '1', @Query('limit') limit = '20') {
    return this.warehouseInventory.listTransfers(req.user.tenantId, Math.max(1, Number(page) || 1), Math.min(100, Math.max(1, Number(limit) || 20)));
  }

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

