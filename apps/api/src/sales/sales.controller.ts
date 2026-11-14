import {
  Body,
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





