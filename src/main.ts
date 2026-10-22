import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { API_PREFIX } from './config/app.config';
import { EnvironmentVariables } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  // Production: skip Nest's per-route "Mapped {...}" startup noise; only warnings and errors.
  const app = await NestFactory.create(AppModule, {
    logger: isProduction ? ['error', 'warn'] : undefined,
  });
  configureApp(app);

  const port = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService).get('PORT', {
    infer: true,
  });
  await app.listen(port);

  if (isProduction) {
    app.useLogger(['log', 'error', 'warn']);
    Logger.log(`Ladder API listening on port ${port} (/${API_PREFIX})`, 'Bootstrap');
  } else {
    Logger.log(`Ladder API listening on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
  }
}

void bootstrap();
