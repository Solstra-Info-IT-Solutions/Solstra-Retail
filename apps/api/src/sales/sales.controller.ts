import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesDto } from './dto/list-sales.dto';
import { CancelSaleDto } from './dto/cancel-sale.dto';
import { AddSalePaymentDto } from './dto/add-sale-payment.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { AddCreditNoteRefundDto } from './dto/add-credit-note-refund.dto';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { CreatePriceRuleDto } from './dto/create-price-rule.dto';
import { UpdatePromotionStatusDto } from './dto/update-promotion-status.dto';
import { CreateWarrantyClaimDto, ReviewWarrantyClaimDto } from './dto/warranty-claim.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';

interface AuthenticatedRequest extends Request {
  user: {
    tenantId: string;
    userId: string;
  };
}

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Permissions('sales.create')
  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSaleDto,
  ) {
    return this.salesService.createSale(
      req.user.tenantId,
      req.user.userId,
      dto,
    );
  }

  @Permissions('sales.view')
  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query() dto: ListSalesDto,
  ) {
    return this.salesService.findAll(req.user.tenantId, dto);
  }

  @Permissions('sales.payments.create')
  @Post(':id/payments')
  addPayment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AddSalePaymentDto,
  ) {
    return this.salesService.addPayment(
      req.user.tenantId,
      req.user.userId,
      id,
      dto,
    );
  }

  @Roles('owner', 'admin')
  @Post(':id/credit-notes')
  createCreditNote(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.salesService.createCreditNote(
      req.user.tenantId,
      req.user.userId,
      id,
      dto,
    );
  }

  @Roles('owner', 'admin')
  @Post(':id/credit-notes/:creditNoteId/refunds')
  addCreditNoteRefund(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('creditNoteId') creditNoteId: string,
    @Body() dto: AddCreditNoteRefundDto,
  ) {
    return this.salesService.addCreditNoteRefund(
      req.user.tenantId,
      req.user.userId,
      id,
      creditNoteId,
      dto,
    );
  }
  @Roles('owner', 'admin')
  @Post('price-rules')
  createPriceRule(@Req() req: AuthenticatedRequest, @Body() dto: CreatePriceRuleDto) {
    return this.salesService.createPriceRule(req.user.tenantId, req.user.userId, dto);
  }

  @Permissions('sales.view')
  @Get('price-rules')
  listPriceRules(@Req() req: AuthenticatedRequest) {
    return this.salesService.listPriceRules(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Patch('price-rules/:id/status')
  updatePriceRuleStatus(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdatePromotionStatusDto) {
    return this.salesService.updatePriceRuleStatus(req.user.tenantId, id, dto.status);
  }

  @Roles('owner', 'admin')
  @Post('promotions')
  createPromotion(@Req() req: AuthenticatedRequest, @Body() dto: CreatePromotionDto) {
    return this.salesService.createPromotion(req.user.tenantId, req.user.userId, dto);
  }

  @Permissions('sales.view')
  @Get('promotions')
  listPromotions(@Req() req: AuthenticatedRequest) {
    return this.salesService.listPromotions(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Patch('promotions/:id/status')
  updatePromotionStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePromotionStatusDto,
  ) {
    return this.salesService.updatePromotionStatus(req.user.tenantId, req.user.userId, id, dto);
  }

  @Roles('owner', 'admin')
  @Get('warranty-claims')
  listWarrantyClaims(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const parsedPage = page === undefined ? 1 : Number(page);
    const parsedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(parsedPage) || parsedPage < 1 || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('Invalid warranty claim pagination');
    }
    return this.salesService.listWarrantyClaims(req.user.tenantId, parsedPage, parsedLimit, status);
  }

  @Roles('owner', 'admin')
  @Patch('warranty-claims/:claimId')
  reviewWarrantyClaim(
    @Req() req: AuthenticatedRequest,
    @Param('claimId') claimId: string,
    @Body() dto: ReviewWarrantyClaimDto,
  ) {
    return this.salesService.reviewWarrantyClaim(req.user.tenantId, req.user.userId, claimId, dto);
  }

  @Permissions('sales.view')
  @Get(':id/warranties')
  findInvoiceWarranties(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.salesService.findInvoiceWarranties(req.user.tenantId, id);
  }

  @Roles('owner', 'admin')
  @Post(':id/warranties/:warrantyId/claims')
  createWarrantyClaim(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('warrantyId') warrantyId: string,
    @Body() dto: CreateWarrantyClaimDto,
  ) {
    return this.salesService.createWarrantyClaim(req.user.tenantId, req.user.userId, id, warrantyId, dto);
  }

  @Permissions('sales.view')
  @Get(':id/credit-notes')
  findCreditNotes(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.salesService.findCreditNotes(
      req.user.tenantId,
      id,
    );
  }

  @Permissions('sales.view')
  @Get(':id')
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.salesService.findOne(req.user.tenantId, id);
  }

  @Roles('owner', 'admin')
  @Patch(':id/cancel')
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CancelSaleDto,
  ) {
    return this.salesService.cancelSale(
      req.user.tenantId,
      req.user.userId,
      id,
      dto.reason,
    );
  }
}





