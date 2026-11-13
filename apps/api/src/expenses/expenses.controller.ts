import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { AddExpensePaymentDto } from './dto/add-expense-payment.dto';
import { ListExpensesDto } from './dto/list-expenses.dto';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  findAll(@Req() req: any, @Query() query: ListExpensesDto) {
    return this.expenses.findAll(req.user.tenantId, query);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.expenses.findOne(req.user.tenantId, id);
  }

  @Post()
  @Roles('owner', 'admin')
  create(@Req() req: any, @Body() dto: CreateExpenseDto) {
    return this.expenses.create(req.user.tenantId, req.user.userId, dto);
  }

  @Post(':id/payments')
  @Roles('owner', 'admin')
  addPayment(@Req() req: any, @Param('id') id: string, @Body() dto: AddExpensePaymentDto) {
    return this.expenses.addPayment(req.user.tenantId, req.user.userId, id, dto);
  }
}
