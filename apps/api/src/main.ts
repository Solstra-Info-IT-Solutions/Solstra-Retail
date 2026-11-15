import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);

  // Allow bounded image data URLs for store logos while retaining raw webhook bytes for signature checks.
  app.use(json({
    limit: '2mb',
    verify: (req: any, _res, buffer) => { req.rawBody = Buffer.from(buffer); },
  }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({
    origin: (config.get<string>('CORS_ORIGIN') ?? '').split(',').map(v => v.trim()).filter(Boolean),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
}
void bootstrap();
