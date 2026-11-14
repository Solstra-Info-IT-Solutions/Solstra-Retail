import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Product, ProductSchema } from '../products/schemas/product.schema';
import {
  InventoryMovement,
  InventoryMovementSchema,
} from './schemas/inventory-movement.schema';

import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { AccountingModule } from '../accounting/accounting.module';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { Warehouse, WarehouseSchema } from '../branches/schemas/warehouse.schema';
import { WarehouseStock, WarehouseStockSchema } from './schemas/warehouse-stock.schema';
import { WarehouseTransfer, WarehouseTransferSchema } from './schemas/warehouse-transfer.schema';
import { WarehouseInventoryService } from './warehouse-inventory.service';
import { ReplenishmentPolicy, ReplenishmentPolicySchema } from './schemas/replenishment-policy.schema';
import { ReplenishmentService } from './replenishment.service';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Supplier, SupplierSchema } from '../suppliers/schemas/supplier.schema';

@Module({
  imports: [
    AccountingModule,
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: WarehouseStock.name, schema: WarehouseStockSchema },
      { name: WarehouseTransfer.name, schema: WarehouseTransferSchema },
      { name: ReplenishmentPolicy.name, schema: ReplenishmentPolicySchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: Supplier.name, schema: SupplierSchema },
      {
        name: InventoryMovement.name,
        schema: InventoryMovementSchema,
      },
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, WarehouseInventoryService, ReplenishmentService],
  exports: [InventoryService],
})
export class InventoryModule {}