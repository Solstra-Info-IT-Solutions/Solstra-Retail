import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Public } from './common/decorators/public.decorator';
import { SkipTrial } from './common/decorators/skip-trial.decorator';

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
  ) {}
  @Public()
  @SkipTrial()
  @Get()
  health() { return { status: 'ok', service: 'solstra-retail-api' }; }

  @Public()
  @SkipTrial()
  @Get('ready')
  readiness() {
    const databaseReady = this.connection.readyState === 1 && Boolean(this.connection.db);
    const checks = {
      database: databaseReady ? 'READY' : 'UNAVAILABLE',
      configuration: this.config.get<string>('MONGODB_URI') ? 'PRESENT' : 'MISSING',
    };
    if (!databaseReady || checks.configuration === 'MISSING') {
      throw new ServiceUnavailableException({ status: 'not_ready', service: 'solstra-retail-api', checks });
    }
    return {
      status: 'ready',
      service: 'solstra-retail-api',
      checks,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
