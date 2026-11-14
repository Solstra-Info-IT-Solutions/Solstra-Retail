import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SalesModule } from '../sales/sales.module';
import { Tenant, TenantSchema } from '../tenants/schemas/tenant.schema';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { WarehouseStock, WarehouseStockSchema } from '../inventory/schemas/warehouse-stock.schema';
import {
  AutomationExecution, AutomationExecutionSchema, AutomationRule, AutomationRuleSchema, BackupArtifact, BackupArtifactSchema, BackupPolicy, BackupPolicySchema,
  OfflineSyncRecord, OfflineSyncRecordSchema, PlatformNotification, SaasAdminAudit, SaasAdminAuditSchema,
  PlatformNotificationSchema, WebhookDelivery, WebhookDeliverySchema,
  WebhookIntegration, WebhookIntegrationSchema,
} from './schemas/platform.schema';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformEventInterceptor } from './platform-event.interceptor';

@Module({
  imports: [
    SalesModule,
    MongooseModule.forFeature([
      { name: AutomationRule.name, schema: AutomationRuleSchema },
      { name: AutomationExecution.name, schema: AutomationExecutionSchema },
      { name: PlatformNotification.name, schema: PlatformNotificationSchema },
      { name: WebhookIntegration.name, schema: WebhookIntegrationSchema },
      { name: WebhookDelivery.name, schema: WebhookDeliverySchema },
      { name: OfflineSyncRecord.name, schema: OfflineSyncRecordSchema },
      { name: BackupPolicy.name, schema: BackupPolicySchema },
      { name: BackupArtifact.name, schema: BackupArtifactSchema },
      { name: SaasAdminAudit.name, schema: SaasAdminAuditSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: User.name, schema: UserSchema },
      { name: Product.name, schema: ProductSchema },
      { name: WarehouseStock.name, schema: WarehouseStockSchema },
    ]),
  ],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformEventInterceptor],
  exports: [PlatformService],
})
export class PlatformModule {}
