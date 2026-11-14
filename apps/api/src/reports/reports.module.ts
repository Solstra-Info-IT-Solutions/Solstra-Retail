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
import { Purchase, PurchaseSchema } from '../purchases/schemas/purchase.schema';
import { Tenant, TenantSchema } from '../tenants/schemas/tenant.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Supplier, SupplierSchema } from '../suppliers/schemas/supplier.schema';
import { GstEInvoiceSubmission, GstEInvoiceSubmissionSchema } from './schemas/gst-einvoice-submission.schema';
import { GstComplianceSubmission, GstComplianceSubmissionSchema } from './schemas/gst-compliance-submission.schema';
import { MigrationImportRun, MigrationImportRunSchema } from './schemas/migration-import-run.schema';
import { HistoricalTransactionImportRun, HistoricalTransactionImportRunSchema, HistoricalTransactionRecord, HistoricalTransactionRecordSchema } from './schemas/historical-transaction-import.schema';

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
      { name: Purchase.name, schema: PurchaseSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Supplier.name, schema: SupplierSchema },
      { name: GstEInvoiceSubmission.name, schema: GstEInvoiceSubmissionSchema },
      { name: GstComplianceSubmission.name, schema: GstComplianceSubmissionSchema },
      { name: MigrationImportRun.name, schema: MigrationImportRunSchema },
      { name: HistoricalTransactionImportRun.name, schema: HistoricalTransactionImportRunSchema },
      { name: HistoricalTransactionRecord.name, schema: HistoricalTransactionRecordSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
