import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { SkipTrial } from './common/decorators/skip-trial.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @SkipTrial()
  @Get()
  health() { return { status: 'ok', service: 'solstra-retail-api' }; }
}
