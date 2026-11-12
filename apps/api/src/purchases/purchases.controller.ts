import {
  Body, Controller, Get, Param, Post, Query, Req,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { ReceivePurchaseDto } from './dto/receive-purchase.dto';
import { ListPurchasesDto } from './dto/list-purchases.dto';

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @Roles('owner', 'admin')
  create(@Req() req: any, @Body() dto: CreatePurchaseDto) {
    return this.purchasesService.create(req.user.tenantId, req.user.userId, dto);
  }

  @Get()
  findAll(@Req() req: any, @Query() query: ListPurchasesDto) {
    return this.purchasesService.findAll(req.user.tenantId, query);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.purchasesService.findOne(req.user.tenantId, id);
  }

  @Post(':id/receive')
  @Roles('owner', 'admin')
  receive(@Req() req: any, @Param('id') id: string, @Body() dto: ReceivePurchaseDto) {
    return this.purchasesService.receive(req.user.tenantId, req.user.userId, id, dto);
  }

  @Post(':id/cancel')
  @Roles('owner', 'admin')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.purchasesService.cancel(req.user.tenantId, req.user.userId, id);
  }
}

