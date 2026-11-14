import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountingModule } from '../accounting/accounting.module';
import { Expense, ExpenseSchema } from './schemas/expense.schema';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [
    AccountingModule,
    MongooseModule.forFeature([{ name: Expense.name, schema: ExpenseSchema }]),
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
