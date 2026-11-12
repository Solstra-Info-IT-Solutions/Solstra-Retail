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

import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsDto } from './dto/list-products.dto';
import { InitializeProductValuationDto } from './dto/initialize-product-valuation.dto';
import { Roles } from '../common/decorators/roles.decorator';

type AuthenticatedRequest = Request & {
  user: {
    tenantId: string;
    userId: string;
    role: string;
  };
};

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
  ) {}

  @Roles('owner', 'admin')
  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(
  req.user.tenantId,
  req.user.userId,
  dto,
);
  }

  @Roles('owner', 'admin')
  @Post(':id/initialize-valuation')
  initializeValuation(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: InitializeProductValuationDto,
  ) {
    return this.productsService.initializeValuation(
      req.user.tenantId, req.user.userId, id, dto,
    );
  }

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListProductsDto,
  ) {
    return this.productsService.findAll(
      req.user.tenantId,
      query,
    );
  }

  
  @Get('low-stock')
  findLowStock(@Req() req: AuthenticatedRequest) {
    return this.productsService.findLowStock(
      req.user.tenantId,
    );
  }


  @Roles('owner', 'admin')
  @Get('valuation-status')
  valuationStatus(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListProductsDto,
  ) {
    return this.productsService.valuationStatus(req.user.tenantId, query);
  }

  @Get(':id')
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.productsService.findOne(
      req.user.tenantId,
      id,
    );
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(
      req.user.tenantId,
      id,
      dto,
    );
  }

  @Roles('owner', 'admin')
  @Delete(':id')
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.productsService.remove(
      req.user.tenantId,
      id,
    );
  }
}



