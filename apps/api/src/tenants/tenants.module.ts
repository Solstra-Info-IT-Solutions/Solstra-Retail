
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Tenant, TenantSchema } from './schemas/tenant.schema';
import { TenantController } from './tenant.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
    ]),
  ],
  controllers: [TenantController],
  providers: [],
  exports: [MongooseModule],
})
export class TenantsModule {}
