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

