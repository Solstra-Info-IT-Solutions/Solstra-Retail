import {
  Controller,
  Get,
  Param,
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

  @Get('reports/trial-balance')
  trialBalance(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.trialBalance(req.user.tenantId, query);
  }

  @Get('reports/general-ledger/:accountCode')
  generalLedger(@Req() req: AuthenticatedRequest, @Param('accountCode') accountCode: string, @Query() query: ReportDateRangeDto) {
    return this.reportsService.generalLedger(req.user.tenantId, accountCode, query);
  }

  @Get('reports/cash-flow')
  cashFlowStatement(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.cashFlowStatement(req.user.tenantId, query);
  }

  @Get('reports/cash-bank-book')
  cashBankBook(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.cashBankBook(req.user.tenantId, query);
  }

  @Get('reports/profit-loss')
  profitAndLoss(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.profitAndLoss(req.user.tenantId, query);
  }

  @Get('reports/balance-sheet')
  balanceSheet(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.balanceSheet(req.user.tenantId, query);
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

  @Get('reports/gst/gstr1')
  gstr1(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.gstr1(req.user.tenantId, query);
  }

  @Get('reports/gst/gstr3b')
  gstr3b(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.gstr3b(req.user.tenantId, query);
  }

  @Get('reports/gst/hsn-summary')
  hsnSummary(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.hsnSummary(req.user.tenantId, query);
  }

  @Get('reports/gst/reconciliation')
  gstReconciliation(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.gstReconciliation(req.user.tenantId, query);
  }


}
