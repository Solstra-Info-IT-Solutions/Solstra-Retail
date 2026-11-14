import { Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';

import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomersService } from './customers.service';

type AuthenticatedRequest = Request & {
  user: { tenantId: string; userId: string; role: string };
};

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Roles('owner', 'admin')
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(req.user.tenantId, dto);
  }

  @Permissions('customers.view')
  @Get()
  findAll(@Req() req: AuthenticatedRequest, @Query() query: ListCustomersDto) {
    return this.customersService.findAll(req.user.tenantId, query);
  }

  @Permissions('customers.view')
  @Get(':id/sales')
  findSalesHistory(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page === undefined ? 1 : Number(page);
    const parsedLimit = limit === undefined ? 20 : Number(limit);

    if (
      !Number.isInteger(parsedPage) ||
      parsedPage < 1 ||
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 100
    ) {
      throw new BadRequestException('Invalid customer history pagination');
    }

    return this.customersService.findSalesHistory(
      req.user.tenantId,
      id,
      parsedPage,
      parsedLimit,
    );
  }

  @Permissions('customers.view')
  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.customersService.findOne(req.user.tenantId, id);
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(req.user.tenantId, id, dto);
  }

  @Roles('owner', 'admin')
  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.customersService.remove(req.user.tenantId, id);
  }
}
