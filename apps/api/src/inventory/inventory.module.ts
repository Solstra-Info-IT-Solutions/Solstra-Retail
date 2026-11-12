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

@Module({
  imports: [
    AccountingModule,
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      {
        name: InventoryMovement.name,
        schema: InventoryMovementSchema,
      },
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}