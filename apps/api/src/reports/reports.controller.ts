import {
  Controller,
  Get,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { ReportsService } from './reports.service';
import { ReportDateRangeDto } from './dto/report-date-range.dto';

type AuthenticatedRequest = Request & {
  user: {
    tenantId: string;
    userId: string;
    role: string;
  };
};

@Controller()
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
  ) {}

  @Get('dashboard/summary')
  dashboardSummary(@Req() req: AuthenticatedRequest) {
    return this.reportsService.dashboardSummary(
      req.user.tenantId,
    );
  }

  @Get('reports/sales')
  salesReport(
    @Req() req: AuthenticatedRequest,
    @Query() query: ReportDateRangeDto,
  ) {
    return this.reportsService.salesReport(
      req.user.tenantId,
      query,
    );
  }

  @Get('reports/inventory')
  inventoryReport(
    @Req() req: AuthenticatedRequest,
    @Query() query: ReportDateRangeDto,
  ) {
    return this.reportsService.inventoryReport(
      req.user.tenantId,
      query,
    );
  }
}
