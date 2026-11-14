 
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { ProductsModule } from './products/products.module';
import { InventoryModule } from './inventory/inventory.module';
import { SalesModule } from './sales/sales.module';
import { CustomersModule } from './customers/customers.module';
import { CategoriesModule } from './categories/categories.module';
import { PurchasesModule } from './purchases/purchases.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ReportsModule } from './reports/reports.module';
import { AccountingModule } from './accounting/accounting.module';
import { ExpensesModule } from './expenses/expenses.module';
import { TrialGuard } from './common/guards/trial.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/api/.env', '.env'],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        autoIndex: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    AuthModule, TenantsModule, ProductsModule, InventoryModule, SalesModule,
    CustomersModule, CategoriesModule, PurchasesModule, SuppliersModule,
    ReportsModule, AccountingModule, ExpensesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TrialGuard },
  ],
})
export class AppModule {}
