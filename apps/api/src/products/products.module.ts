import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Product, ProductSchema } from './schemas/product.schema';
import {
  InventoryMovement,
  InventoryMovementSchema,
} from '../inventory/schemas/inventory-movement.schema';

import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Category, CategorySchema } from '../categories/schemas/category.schema';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [
    AccountingModule,
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Category.name, schema: CategorySchema },
      {
        name: InventoryMovement.name,
        schema: InventoryMovementSchema,
      },
    ]),
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}




