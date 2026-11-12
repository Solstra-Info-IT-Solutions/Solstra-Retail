import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Product, ProductSchema } from '../products/schemas/product.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Tenant, TenantSchema } from '../tenants/schemas/tenant.schema';
import {
  InventoryMovement,
  InventoryMovementSchema,
} from '../inventory/schemas/inventory-movement.schema';

import {
  SalesInvoice,
  SalesInvoiceSchema,
} from './schemas/sales-invoice.schema';
import {
  InvoiceCounter,
  InvoiceCounterSchema,
} from './schemas/invoice-counter.schema';
import {
  CreditNote,
  CreditNoteSchema,
} from './schemas/credit-note.schema';
import {
  CreditNoteCounter,
  CreditNoteCounterSchema,
} from './schemas/credit-note-counter.schema';

import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: InventoryMovement.name, schema: InventoryMovementSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: InvoiceCounter.name, schema: InvoiceCounterSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      { name: CreditNoteCounter.name, schema: CreditNoteCounterSchema },
    ]),
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
