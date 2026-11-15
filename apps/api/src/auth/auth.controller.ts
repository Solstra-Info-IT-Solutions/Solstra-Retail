import { Controller, Get, Post, Patch, Body, Req, Param } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { SkipTrial } from '../common/decorators/skip-trial.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PERMISSION_CATALOG } from '../common/decorators/permissions.decorator';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { RequestPasswordChangeDto } from './dto/request-password-change.dto';
import { ReviewApprovalDto } from './dto/review-approval.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @SkipTrial()
  @Post('register')
  register(@Body() dto: RegisterDto) { return this.auth.register(dto); }

  @Public()
  @SkipTrial()
  @Post('login')
  login(@Body() dto: LoginDto) { return this.auth.login(dto); }

  @Roles('owner', 'admin')
  @Get('permissions')
  listPermissions() {
    return PERMISSION_CATALOG.map((key) => ({ key }));
  }

  @Roles('owner', 'admin')
  @Post('users')
  createStaffUser(@Req() req: Request & { user: any }, @Body() dto: CreateStaffUserDto) {
    return this.auth.createStaffUser(req.user.tenantId, dto);
  }

  @Roles('owner', 'admin')
  @Get('users')
  listUsers(@Req() req: Request & { user: any }): Promise<any[]> {
    return this.auth.listTenantUsers(req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @Patch('users/:id/permissions')
  updateUserPermissions(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body() dto: UpdateUserPermissionsDto,
  ) {
    return this.auth.updateUserPermissions(req.user.tenantId, req.user.userId, id, dto);
  }

  @SkipTrial()
  @Post('password-change-requests')
  requestPasswordChange(@Req() req: Request & { user: any }, @Body() dto: RequestPasswordChangeDto) {
    return this.auth.requestPasswordChange(req.user.userId, req.user.tenantId, dto);
  }

  @SkipTrial()
  @Get('password-change-requests/me')
  myPasswordChangeRequest(@Req() req: Request & { user: any }) {
    return this.auth.getMyPasswordChangeRequest(req.user.userId, req.user.tenantId);
  }

  @Roles('owner', 'admin')
  @SkipTrial()
  @Get('platform/registration-requests')
  listRegistrationApprovalRequests(@Req() req: Request & { user: any }) {
    return this.auth.listRegistrationApprovalRequests(req.user.userId);
  }

  @Roles('owner', 'admin')
  @SkipTrial()
  @Post('platform/registration-requests/:id/review')
  reviewRegistrationApproval(@Req() req: Request & { user: any }, @Param('id') id: string, @Body() dto: ReviewApprovalDto) {
    return this.auth.reviewRegistrationApproval(req.user.userId, id, dto.decision, dto.reason);
  }

  @Roles('owner', 'admin')
  @SkipTrial()
  @Get('platform/password-change-requests')
  listPasswordChangeApprovalRequests(@Req() req: Request & { user: any }) {
    return this.auth.listPasswordChangeApprovalRequests(req.user.userId);
  }

  @Roles('owner', 'admin')
  @SkipTrial()
  @Post('platform/password-change-requests/:id/review')
  reviewPasswordChangeApproval(@Req() req: Request & { user: any }, @Param('id') id: string, @Body() dto: ReviewApprovalDto) {
    return this.auth.reviewPasswordChangeApproval(req.user.userId, id, dto.decision, dto.reason);
  }

  @SkipTrial()
  @Get('me')
  me(@Req() req: Request & { user: any }) {
    return { user: req.user };
  }
}
