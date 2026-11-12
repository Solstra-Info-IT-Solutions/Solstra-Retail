import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  Product,
  ProductSchema,
} from '../products/schemas/product.schema';
import {
  SalesInvoice,
  SalesInvoiceSchema,
} from '../sales/schemas/sales-invoice.schema';
import {
  CreditNote,
  CreditNoteSchema,
} from '../sales/schemas/credit-note.schema';
import {
  InventoryMovement,
  InventoryMovementSchema,
} from '../inventory/schemas/inventory-movement.schema';
import { Account, AccountSchema } from '../accounting/schemas/account.schema';
import { JournalEntry, JournalEntrySchema } from '../accounting/schemas/journal-entry.schema';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: CreditNote.name, schema: CreditNoteSchema },
      {
        name: InventoryMovement.name,
        schema: InventoryMovementSchema,
      },
      { name: Account.name, schema: AccountSchema },
      { name: JournalEntry.name, schema: JournalEntrySchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
