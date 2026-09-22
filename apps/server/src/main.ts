import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@victorflow/db';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';
import { loadConfig } from './config/config';

async function bootstrap() {
  loadEnv(); // <repo>/.env → process.env (real environment variables still win)
  const config = loadConfig(); // fail fast, with a readable message, on a bad environment

  const app = await NestFactory.create(AppModule);
  configureApp(app, config);
  await app.listen(config.port);
  new Logger('Bootstrap').log(`VictorFlow API on http://localhost:${config.port}/${API_PREFIX} (${config.nodeEnv})`);
}

bootstrap().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
