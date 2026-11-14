import {
  Body, Controller, Get, Param, Post, Query, Req,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { ReceivePurchaseDto } from './dto/receive-purchase.dto';
import { AddPurchasePaymentDto } from './dto/add-purchase-payment.dto';
import { ListPurchasesDto } from './dto/list-purchases.dto';
import { ReviewPurchaseItcDto } from './dto/review-purchase-itc.dto';

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @Roles('owner', 'admin')
  create(@Req() req: any, @Body() dto: CreatePurchaseDto) {
    return this.purchasesService.create(req.user.tenantId, req.user.userId, dto);
  }

  @Permissions('purchases.view')
  @Get()
  findAll(@Req() req: any, @Query() query: ListPurchasesDto) {
    return this.purchasesService.findAll(req.user.tenantId, query);
  }

  @Permissions('purchases.view')
  @Get('itc-review-summary')
  itcReviewSummary(@Req() req: any) {
    return this.purchasesService.itcReviewSummary(req.user.tenantId);
  }

  @Post(':id/itc-review')
  @Roles('owner', 'admin')
  reviewItc(@Req() req: any, @Param('id') id: string, @Body() dto: ReviewPurchaseItcDto) {
    return this.purchasesService.reviewItc(req.user.tenantId, req.user.userId, id, dto);
  }

  @Permissions('purchases.view')
  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.purchasesService.findOne(req.user.tenantId, id);
  }

  @Post(':id/receive')
  @Roles('owner', 'admin')
  receive(@Req() req: any, @Param('id') id: string, @Body() dto: ReceivePurchaseDto) {
    return this.purchasesService.receive(req.user.tenantId, req.user.userId, id, dto);
  }

  @Post(':id/payments')
  @Roles('owner', 'admin')
  addPayment(@Req() req: any, @Param('id') id: string, @Body() dto: AddPurchasePaymentDto) {
    return this.purchasesService.addPayment(req.user.tenantId, req.user.userId, id, dto);
  }

  @Permissions('purchases.view')
  @Get('supplier/:supplierId/ledger')
  supplierLedger(@Req() req: any, @Param('supplierId') supplierId: string, @Query() query: ListPurchasesDto) {
    return this.purchasesService.supplierLedger(req.user.tenantId, supplierId, query);
  }

  @Post(':id/cancel')
  @Roles('owner', 'admin')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.purchasesService.cancel(req.user.tenantId, req.user.userId, id);
  }
}

