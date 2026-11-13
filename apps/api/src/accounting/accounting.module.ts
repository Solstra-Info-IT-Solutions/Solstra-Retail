import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from './schemas/account.schema';
import { JournalEntry, JournalEntrySchema } from './schemas/journal-entry.schema';
import { TaxPeriod, TaxPeriodSchema } from './schemas/tax-period.schema';
import { AccountingController } from './accounting.controller';
import { TaxPeriodsController } from './tax-periods.controller';
import { AccountingService } from './accounting.service';
import { TaxPeriodsService } from './tax-periods.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Account.name, schema: AccountSchema },
    { name: JournalEntry.name, schema: JournalEntrySchema },
    { name: TaxPeriod.name, schema: TaxPeriodSchema },
  ])],
  controllers: [AccountingController, TaxPeriodsController],
  providers: [AccountingService, TaxPeriodsService],
  exports: [AccountingService, TaxPeriodsService],
})
export class AccountingModule {}
