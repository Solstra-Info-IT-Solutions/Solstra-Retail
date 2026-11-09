import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { SkipTrial } from '../common/decorators/skip-trial.decorator';

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

  @SkipTrial()
  @Get('me')
  me(@Req() req: Request & { user: any }) {
    return { user: req.user };
  }
}
