import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTrial } from '../common/decorators/skip-trial.decorator';
import { PlatformService } from './platform.service';
import {
  BackupPolicyDto, CreateAutomationRuleDto, CreateWebhookDto, OfflineSyncBatchDto,
  TriggerAutomationDto, UpdateAutomationRuleDto, UpdateSaasTenantDto,
  UpdateWebhookDto, VerifyBackupDto, RegisterOfflineDeviceDto, CreateCommunicationProviderDto, SendCommunicationDto, RecordSubscriptionPaymentDto,
} from './dto/platform.dto';

type AuthenticatedRequest = Request & { user: { tenantId: string; userId: string; role: string }; rawBody?: Buffer };

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
  @Post('integrations/webhooks/:id/rotate-secret')
  rotateWebhookSecret(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.platform.rotateWebhookSecret(req.user.tenantId, id);
  }

  @Roles('owner', 'admin')
  @Get('integrations/webhook-deliveries')
  listWebhookDeliveries(@Req() req: AuthenticatedRequest, @Query('integrationId') integrationId?: string, @Query('page') page = '1') {
    return this.platform.listWebhookDeliveries(req.user.tenantId, integrationId, Number(page));
  }

  @Roles('owner', 'admin')
  @Post('integrations/webhook-deliveries/:id/retry')
  retryWebhookDelivery(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.platform.retryWebhookDelivery(req.user.tenantId, id);
  }

  @Roles('owner', 'admin')
  @Post('integrations/webhooks/deliver-due')
  deliverWebhooks(@Req() req: AuthenticatedRequest, @Query('limit') limit = '20') {
    return this.platform.runWebhookDeliveries(req.user.tenantId, Number(limit));
  }

  @Post('offline/devices/register')
  registerOfflineDevice(@Req() req: AuthenticatedRequest, @Body() dto: RegisterOfflineDeviceDto) {
    return this.platform.registerOfflineDevice(req.user.tenantId, req.user.userId, dto);
  }

  @Get('offline/devices')
  listOfflineDevices(@Req() req: AuthenticatedRequest) {
    return this.platform.listOfflineDevices(req.user.tenantId, req.user.userId);
  }

  @Roles('owner', 'admin')
  @Post('offline/devices/:deviceId/revoke')
  revokeOfflineDevice(@Req() req: AuthenticatedRequest, @Param('deviceId') deviceId: string) {
    return this.platform.revokeOfflineDevice(req.user.tenantId, deviceId);
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
  @Post('backups/verify')
  verifyBackup(@Req() req: AuthenticatedRequest, @Body() dto: VerifyBackupDto) {
    return this.platform.verifyBackup(req.user.tenantId, dto);
  }

  @Roles('owner', 'admin')
  @Get('communications/providers')
  listCommunicationProviders(@Req() req: AuthenticatedRequest) {
    return this.platform.listCommunicationProviders(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Post('communications/providers')
  createCommunicationProvider(@Req() req: AuthenticatedRequest, @Body() dto: CreateCommunicationProviderDto) {
    return this.platform.createCommunicationProvider(req.user.tenantId, dto);
  }

  @Roles('owner', 'admin')
  @Patch('communications/providers/:id')
  updateCommunicationProvider(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.platform.updateCommunicationProvider(req.user.tenantId, id, dto.enabled);
  }

  @Public()
  @SkipTrial()
  @Post('communications/callback/:deliveryId')
  communicationReceipt(@Req() req: AuthenticatedRequest, @Param('deliveryId') deliveryId: string) {
    const signature = req.headers['x-solstra-communication-signature'];
    return this.platform.recordCommunicationReceipt(deliveryId, req.rawBody, Array.isArray(signature) ? signature[0] : signature);
  }

  @Roles('owner', 'admin')
  @Post('communications/send')
  queueCommunication(@Req() req: AuthenticatedRequest, @Body() dto: SendCommunicationDto) {
    return this.platform.queueCommunication(req.user.tenantId, req.user.userId, dto);
  }

  @Roles('owner', 'admin')
  @Get('communications/deliveries')
  listCommunicationDeliveries(@Req() req: AuthenticatedRequest, @Query('page') page = '1') {
    return this.platform.listCommunicationDeliveries(req.user.tenantId, Number(page));
  }

  @Roles('owner', 'admin')
  @Post('communications/deliver-due')
  runCommunicationDeliveries(@Req() req: AuthenticatedRequest, @Query('limit') limit = '20') {
    return this.platform.runCommunicationDeliveries(req.user.tenantId, Number(limit));
  }

  @Roles('owner', 'admin')
  @Get('billing/invoices')
  listSubscriptionInvoices(@Req() req: AuthenticatedRequest) {
    return this.platform.listSubscriptionInvoices(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Post('billing/invoices')
  requestSubscriptionInvoice(@Req() req: AuthenticatedRequest) {
    return this.platform.requestSubscriptionInvoice(req.user.tenantId, req.user.userId);
  }

  @Roles('owner', 'admin')
  @Post('billing/invoices/:id/checkout')
  createSubscriptionCheckout(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.platform.createSubscriptionCheckout(req.user.tenantId, req.user.userId, id);
  }

  @Public()
  @SkipTrial()
  @Post('billing/webhook/razorpay')
  razorpayWebhook(@Req() req: AuthenticatedRequest) {
    const signature = req.headers['x-razorpay-signature'];
    return this.platform.handleRazorpayWebhook(req.rawBody, Array.isArray(signature) ? signature[0] : signature);
  }

  @Get('saas/plans')
  listSubscriptionPlans() {
    return this.platform.listPlatformSubscriptionPlans();
  }

  @Get('saas/billing/invoices')
  listPlatformSubscriptionInvoices(@Req() req: AuthenticatedRequest) {
    return this.platform.listPlatformSubscriptionInvoices(req.user.userId);
  }

  @Patch('saas/billing/invoices/:id/paid')
  recordSubscriptionPayment(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: RecordSubscriptionPaymentDto) {
    return this.platform.recordSubscriptionPayment(req.user.userId, id, dto);
  }

  @Roles('owner', 'admin')
  @Post('backups/:id/replicate')
  replicateBackup(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.platform.replicateBackupArtifact(req.user.tenantId, id);
  }

  @Roles('owner', 'admin')
  @Post('backups/:id/restore-drill')
  runBackupRestoreDrill(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.platform.runBackupRestoreDrill(req.user.tenantId, id);
  }

  @Roles('owner', 'admin')
  @Get('backups/restore-drills')
  listBackupRestoreDrills(@Req() req: AuthenticatedRequest, @Query('artifactId') artifactId?: string) {
    return this.platform.listBackupRestoreDrills(req.user.tenantId, artifactId);
  }

  @Roles('owner', 'admin')
  @Get('operations/security-posture')
  securityPosture(@Req() req: AuthenticatedRequest) {
    return this.platform.platformSecurityPosture(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Get('operations/metrics')
  operationsMetrics(@Req() req: AuthenticatedRequest) {
    return this.platform.operationsMetrics(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Get('backups/replication-events')
  listBackupReplicationEvents(@Req() req: AuthenticatedRequest, @Query('artifactId') artifactId?: string) {
    return this.platform.listBackupReplicationEvents(req.user.tenantId, artifactId);
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

  @Get('saas/audit')
  saasAudit(@Req() req: AuthenticatedRequest) {
    return this.platform.listSaasAdminAudit(req.user.userId);
  }

  @Get('saas/usage')
  saasUsage(@Req() req: AuthenticatedRequest) {
    return this.platform.platformUsageSummary(req.user.userId);
  }
}
