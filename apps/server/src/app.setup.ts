import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { requestContextMiddleware } from './common/request-context';
import type { AppConfig } from './config/config';

export const API_PREFIX = 'api/v1';

/** Everything that is not a module: shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.setGlobalPrefix(API_PREFIX);
  if (config.trustProxy) app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet());
  app.use(requestContextMiddleware);
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
