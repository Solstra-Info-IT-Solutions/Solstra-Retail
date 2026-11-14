import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { ReportsService } from './reports.service';
import { ReportDateRangeDto } from './dto/report-date-range.dto';
import { BusinessQuestionDto } from './dto/business-question.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';

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

  @Permissions('dashboard.view')
  @Get('dashboard/summary')
  dashboardSummary(@Req() req: AuthenticatedRequest) {
    return this.reportsService.dashboardSummary(
      req.user.tenantId,
    );
  }

  @Permissions('reports.view')
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

  @Permissions('reports.view')
  @Get('reports/trial-balance')
  trialBalance(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.trialBalance(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/general-ledger/:accountCode')
  generalLedger(@Req() req: AuthenticatedRequest, @Param('accountCode') accountCode: string, @Query() query: ReportDateRangeDto) {
    return this.reportsService.generalLedger(req.user.tenantId, accountCode, query);
  }

  @Permissions('reports.view')
  @Get('reports/cash-flow')
  cashFlowStatement(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.cashFlowStatement(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/cash-bank-book')
  cashBankBook(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.cashBankBook(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/profit-loss')
  profitAndLoss(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.profitAndLoss(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/balance-sheet')
  balanceSheet(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.balanceSheet(req.user.tenantId, query);
  }

  @Roles('owner', 'admin')
  @Post('reports/gst/einvoice/:invoiceId/submit')
  submitGstEInvoice(@Req() req: AuthenticatedRequest, @Param('invoiceId') invoiceId: string) {
    return this.reportsService.submitGstEInvoice(req.user.tenantId, invoiceId);
  }

  @Roles('owner', 'admin')
  @Get('reports/gst/submissions')
  listGstComplianceSubmissions(@Req() req: AuthenticatedRequest, @Query('page') page = '1') {
    return this.reportsService.listGstComplianceSubmissions(req.user.tenantId, Number(page));
  }

  @Roles('owner', 'admin')
  @Post('reports/gst/submissions/:type/:reference')
  submitGstCompliance(@Req() req: AuthenticatedRequest, @Param('type') type: string, @Param('reference') reference: string) {
    return this.reportsService.submitGstCompliance(req.user.tenantId, type.toUpperCase(), reference);
  }

  @Roles('owner', 'admin')
  @Get('reports/migration/readiness')
  migrationReadiness(@Req() req: AuthenticatedRequest) {
    return this.reportsService.migrationReadiness(req.user.tenantId);
  }

  @Permissions('reports.view')
  @Get('reports/gst/einvoice-readiness')
  gstEinvoiceReadiness(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.gstEinvoiceReadiness(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/accounting/journal-export')
  async accountingJournalExport(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto, @Res() response: Response) {
    const file = await this.reportsService.accountingJournalCsvExport(req.user.tenantId, query);
    return response.status(200).set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).send(file.content);
  }

  @Permissions('reports.view')
  @Post('reports/assistant/query')
  answerBusinessQuestion(@Req() req: AuthenticatedRequest, @Body() dto: BusinessQuestionDto) {
    return this.reportsService.answerBusinessQuestion(req.user.tenantId, dto.question);
  }

  @Permissions('reports.view')
  @Get('reports/analytics/demand-forecast')
  demandForecast(@Req() req: AuthenticatedRequest, @Query('horizonDays') horizonDays = '30') {
    const parsed = Number(horizonDays);
    if (!Number.isInteger(parsed) || parsed < 7 || parsed > 90) {
      throw new BadRequestException('Forecast horizon must be between 7 and 90 days');
    }
    return this.reportsService.demandForecast(req.user.tenantId, parsed);
  }

  @Permissions('reports.view')
  @Get('reports/analytics/overview')
  advancedAnalytics(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.advancedAnalytics(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/assistant/insights')
  businessAssistantInsights(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.businessAssistantInsights(req.user.tenantId, query);
  }

  @Permissions('reports.view')
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

  @Permissions('reports.view')
  @Get('reports/accounting/tally-xml')
  async tallyXmlExport(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto, @Res() response: Response) {
    const file = await this.reportsService.tallyXmlExport(req.user.tenantId, query);
    return response.status(200).set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).send(file.content);
  }

  @Permissions('reports.view')
  @Get('reports/gst/export/:report')
  async gstCsvExport(
    @Req() req: AuthenticatedRequest,
    @Param('report') report: string,
    @Query() query: ReportDateRangeDto,
    @Res() response: Response,
  ) {
    const file = await this.reportsService.gstCsvExport(req.user.tenantId, report, query);
    return response
      .status(200)
      .set({
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(file.content);
  }

  @Permissions('reports.view')
  @Get('reports/gst/gstr1')
  gstr1(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.gstr1(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/gst/gstr3b')
  gstr3b(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.gstr3b(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/gst/purchase-register')
  gstPurchaseRegister(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.gstPurchaseRegister(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/gst/hsn-inward-summary')
  inwardHsnSummary(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.inwardHsnSummary(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/gst/hsn-summary')
  hsnSummary(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.hsnSummary(req.user.tenantId, query);
  }

  @Permissions('reports.view')
  @Get('reports/gst/reconciliation')
  gstReconciliation(@Req() req: AuthenticatedRequest, @Query() query: ReportDateRangeDto) {
    return this.reportsService.gstReconciliation(req.user.tenantId, query);
  }


}
