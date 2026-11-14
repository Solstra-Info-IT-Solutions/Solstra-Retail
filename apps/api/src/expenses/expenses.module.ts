import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountingModule } from '../accounting/accounting.module';
import { Expense, ExpenseSchema } from './schemas/expense.schema';
import { RecurringExpenseSchedule, RecurringExpenseScheduleSchema } from './schemas/recurring-expense.schema';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { RecurringExpensesController } from './recurring-expenses.controller';
import { RecurringExpensesService } from './recurring-expenses.service';

@Module({
  imports: [
    AccountingModule,
    MongooseModule.forFeature([
      { name: Expense.name, schema: ExpenseSchema },
      { name: RecurringExpenseSchedule.name, schema: RecurringExpenseScheduleSchema },
    ]),
  ],
  controllers: [ExpensesController, RecurringExpensesController],
  providers: [ExpensesService, RecurringExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
