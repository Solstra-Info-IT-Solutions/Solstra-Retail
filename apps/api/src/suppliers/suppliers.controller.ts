import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { Roles } from '../common/decorators/roles.decorator';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSuppliersDto } from './dto/list-suppliers.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

type AuthenticatedRequest = Request & {
  user: { tenantId: string; userId: string; role: string };
};

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Roles('owner', 'admin')
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(req.user.tenantId, dto);
  }

  @Get()
  findAll(@Req() req: AuthenticatedRequest, @Query() query: ListSuppliersDto) {
    return this.suppliersService.findAll(req.user.tenantId, query);
  }

  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.suppliersService.findOne(req.user.tenantId, id);
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(req.user.tenantId, id, dto);
  }

  @Roles('owner', 'admin')
  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.suppliersService.remove(req.user.tenantId, id);
  }
}
