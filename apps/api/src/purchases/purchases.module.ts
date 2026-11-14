import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { Warehouse, WarehouseSchema } from '../branches/schemas/warehouse.schema';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { WarehouseStock, WarehouseStockSchema } from '../inventory/schemas/warehouse-stock.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { Supplier, SupplierSchema } from '../suppliers/schemas/supplier.schema';
import { Tenant, TenantSchema } from '../tenants/schemas/tenant.schema';
import { InventoryMovement, InventoryMovementSchema } from '../inventory/schemas/inventory-movement.schema';
import { Purchase, PurchaseSchema } from './schemas/purchase.schema';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [
    AccountingModule,
    MongooseModule.forFeature([
      { name: Purchase.name, schema: PurchaseSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Supplier.name, schema: SupplierSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: InventoryMovement.name, schema: InventoryMovementSchema },
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: WarehouseStock.name, schema: WarehouseStockSchema },
    ]),
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
