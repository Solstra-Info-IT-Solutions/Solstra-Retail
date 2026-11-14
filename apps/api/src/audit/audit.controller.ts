import { Controller, Get, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@Roles('owner', 'admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Req() req: any, @Query('page') page = '1', @Query('limit') limit = '50') {
    return this.audit.list(req.user.tenantId, Number(page), Number(limit));
  }
}
