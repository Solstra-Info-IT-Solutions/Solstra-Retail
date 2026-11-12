import { Body, Controller, Get, Post, Query, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { ReverseJournalDto } from './dto/reverse-journal.dto';
import { AccountingService } from './accounting.service';

type AuthenticatedRequest = Request & { user: { tenantId: string; userId: string } };

@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('accounts')
  listAccounts(@Req() req: AuthenticatedRequest) {
    return this.accounting.listAccounts(req.user.tenantId, req.user.userId);
  }

  @Roles('owner', 'admin')
  @Post('accounts')
  createAccount(@Req() req: AuthenticatedRequest, @Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(req.user.tenantId, req.user.userId, dto);
  }

  @Roles('owner', 'admin')
  @Post('opening-balances')
  createOpeningBalances(@Req() req: AuthenticatedRequest, @Body() dto: CreateOpeningBalanceDto) {
    return this.accounting.createOpeningBalances(req.user.tenantId, req.user.userId, dto);
  }

  @Roles('owner', 'admin')
  @Post('journals')
  createJournal(@Req() req: AuthenticatedRequest, @Body() dto: CreateJournalEntryDto) {
    return this.accounting.createJournal(req.user.tenantId, req.user.userId, dto);
  }

  @Get('journals')
  listJournals(@Req() req: AuthenticatedRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.accounting.listJournals(req.user.tenantId, Number(page) || 1, Number(limit) || 20);
  }

  @Roles('owner', 'admin')
  @Post('journals/:id/reverse')
  reverseJournal(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: ReverseJournalDto) {
    return this.accounting.reverseJournal(req.user.tenantId, req.user.userId, id, dto.reason);
  }
}
