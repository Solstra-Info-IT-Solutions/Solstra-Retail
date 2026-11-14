import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PlatformService } from './platform.service';
import {
  BackupPolicyDto, CreateAutomationRuleDto, CreateWebhookDto, OfflineSyncBatchDto,
  TriggerAutomationDto, UpdateAutomationRuleDto, UpdateSaasTenantDto,
  UpdateWebhookDto, VerifyBackupDto,
} from './dto/platform.dto';

type AuthenticatedRequest = Request & { user: { tenantId: string; userId: string; role: string } };

@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Roles('owner', 'admin')
  @Post('automation/rules')
  createAutomation(@Req() req: AuthenticatedRequest, @Body() dto: CreateAutomationRuleDto) {
    return this.platform.createAutomationRule(req.user.tenantId, req.user.userId, dto);
  }

  @Roles('owner', 'admin')
  @Get('automation/rules')
  listAutomation(@Req() req: AuthenticatedRequest) {
    return this.platform.listAutomationRules(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Patch('automation/rules/:id')
  updateAutomation(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateAutomationRuleDto) {
    return this.platform.updateAutomationRule(req.user.tenantId, id, dto);
  }

  @Roles('owner', 'admin')
  @Post('automation/trigger')
  triggerAutomation(@Req() req: AuthenticatedRequest, @Body() dto: TriggerAutomationDto) {
    return this.platform.triggerAutomation(req.user.tenantId, req.user.userId, dto);
  }

  @Get('notifications')
  notifications(@Req() req: AuthenticatedRequest, @Query('unreadOnly') unreadOnly = 'false', @Query('page') page = '1') {
    return this.platform.listNotifications(req.user.tenantId, req.user.userId, unreadOnly === 'true', Number(page));
  }

  @Patch('notifications/:id/read')
  markNotificationRead(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.platform.markNotificationRead(req.user.tenantId, req.user.userId, id);
  }

  @Roles('owner', 'admin')
  @Post('integrations/webhooks')
  createWebhook(@Req() req: AuthenticatedRequest, @Body() dto: CreateWebhookDto) {
    return this.platform.createWebhook(req.user.tenantId, dto);
  }

  @Roles('owner', 'admin')
  @Get('integrations/webhooks')
  listWebhooks(@Req() req: AuthenticatedRequest) {
    return this.platform.listWebhooks(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Patch('integrations/webhooks/:id')
  updateWebhook(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.platform.updateWebhook(req.user.tenantId, id, dto);
  }

  @Roles('owner', 'admin')
  @Post('integrations/webhooks/deliver-due')
  deliverWebhooks(@Req() req: AuthenticatedRequest, @Query('limit') limit = '20') {
    return this.platform.runWebhookDeliveries(req.user.tenantId, Number(limit));
  }

  @Permissions('sales.create')
  @Post('offline/sync')
  syncOfflineSales(@Req() req: AuthenticatedRequest, @Body() dto: OfflineSyncBatchDto) {
    return this.platform.syncOfflineSales(req.user.tenantId, req.user.userId, dto);
  }

  @Roles('owner', 'admin')
  @Get('backups/policy')
  getBackupPolicy(@Req() req: AuthenticatedRequest) {
    return this.platform.getBackupPolicy(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Patch('backups/policy')
  updateBackupPolicy(@Req() req: AuthenticatedRequest, @Body() dto: BackupPolicyDto) {
    return this.platform.updateBackupPolicy(req.user.tenantId, dto);
  }

  @Roles('owner', 'admin')
  @Post('backups/export')
  exportBackup(@Req() req: AuthenticatedRequest) {
    return this.platform.exportTenantBackup(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Get('backups')
  listBackups(@Req() req: AuthenticatedRequest) {
    return this.platform.listBackupArtifacts(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Get('backups/:id/download')
  downloadBackup(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.platform.downloadBackupArtifact(req.user.tenantId, id);
  }

  @Roles('owner', 'admin')
  @Post('backups/run-due')
  runDueBackup(@Req() req: AuthenticatedRequest) {
    return this.platform.runScheduledBackupJobs();
  }

  @Roles('owner', 'admin')
  @Post('backups/verify')
  verifyBackup(@Req() req: AuthenticatedRequest, @Body() dto: VerifyBackupDto) {
    return this.platform.verifyBackup(req.user.tenantId, dto);
  }

  @Roles('owner', 'admin')
  @Get('inventory/valuation-reconciliation')
  valuationReconciliation(@Req() req: AuthenticatedRequest) {
    return this.platform.valuationReconciliation(req.user.tenantId);
  }

  @Get('saas/tenants')
  listSaasTenants(@Req() req: AuthenticatedRequest) {
    return this.platform.listSaasTenants(req.user.userId);
  }

  @Patch('saas/tenants/:id')
  updateSaasTenant(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateSaasTenantDto) {
    return this.platform.updateSaasTenant(req.user.userId, id, dto);
  }

  @Get('saas/usage')
  saasUsage(@Req() req: AuthenticatedRequest) {
    return this.platform.platformUsageSummary(req.user.userId);
  }
}
