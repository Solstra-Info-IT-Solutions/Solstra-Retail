import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto';
import { RecurringExpensesService } from './recurring-expenses.service';

@Controller('expenses/recurring')
@Roles('owner', 'admin')
export class RecurringExpensesController {
  constructor(private readonly recurring: RecurringExpensesService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateRecurringExpenseDto) {
    return this.recurring.create(req.user.tenantId, req.user.userId, dto);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.recurring.findAll(req.user.tenantId);
  }

  @Post('run-due')
  runDue(@Req() req: any) {
    return this.recurring.runDue(req.user.tenantId, req.user.userId);
  }

  @Post(':id/pause')
  pause(@Req() req: any, @Param('id') id: string) {
    return this.recurring.setStatus(req.user.tenantId, id, 'PAUSED');
  }

  @Post(':id/resume')
  resume(@Req() req: any, @Param('id') id: string) {
    return this.recurring.setStatus(req.user.tenantId, id, 'ACTIVE');
  }
}
