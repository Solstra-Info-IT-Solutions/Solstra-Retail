import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { TaxPeriodDto } from './dto/tax-period.dto';
import { TaxPeriodsService } from './tax-periods.service';

type AuthenticatedRequest = Request & { user: { tenantId: string; userId: string } };

@Controller('accounting/tax-periods')
export class TaxPeriodsController {
  constructor(private readonly periods: TaxPeriodsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.periods.list(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Post('close')
  close(@Req() req: AuthenticatedRequest, @Body() dto: TaxPeriodDto) {
    return this.periods.close(req.user.tenantId, req.user.userId, dto);
  }

  @Roles('owner', 'admin')
  @Post('reopen')
  reopen(@Req() req: AuthenticatedRequest, @Body() dto: TaxPeriodDto) {
    return this.periods.reopen(req.user.tenantId, req.user.userId, dto);
  }
}
