import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from './schemas/branch.schema';
import { Warehouse, WarehouseSchema } from './schemas/warehouse.schema';
import { WarehouseStock, WarehouseStockSchema } from '../inventory/schemas/warehouse-stock.schema';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Branch.name, schema: BranchSchema },
    { name: Warehouse.name, schema: WarehouseSchema },
    { name: WarehouseStock.name, schema: WarehouseStockSchema },
  ])],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}