import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  SalesInvoice,
  SalesInvoiceSchema,
} from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { LoyaltyLedger, LoyaltyLedgerSchema } from './schemas/loyalty-ledger.schema';
import { LoyaltyRewardVoucher, LoyaltyRewardVoucherSchema } from './schemas/loyalty-reward-voucher.schema';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: LoyaltyLedger.name, schema: LoyaltyLedgerSchema },
      { name: LoyaltyRewardVoucher.name, schema: LoyaltyRewardVoucherSchema },
    ]),
  ],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
