import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LoginResponse } from '@victorflow/types';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { loadConfig } from '../../src/config/config';
import { DbService } from '../../src/infra/db/db.service';

export const TEST_PASSWORD = 'Test-Password-1';

export const USERS = {
  admin: 'admin@victorflow.local',
  sales: 'sales@victorflow.local',
  production: 'production@victorflow.local',
  workshop: 'workshop@victorflow.local',
  qa: 'qa@victorflow.local',
  field: 'field@victorflow.local',
} as const;

export async function createTestApp(extraControllers: Type<unknown>[] = []): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: extraControllers }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, loadConfig());
  // Listen ONCE on an ephemeral loopback port. If the server is not listening, supertest calls server.listen(0) for
  // EVERY request — and our concurrency tests fire many at once, i.e. many simultaneous listen() calls on one
  // http.Server, which intermittently aborted the whole Node process on Windows. A server that is already
  // listening is reused as-is.
  await app.listen(0, '127.0.0.1');
  return app;
}

export const http = (app: INestApplication) => request(app.getHttpServer());
export const dbOf = (app: INestApplication) => app.get(DbService);
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function login(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<LoginResponse> {
  const res = await http(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login(${email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as LoginResponse;
}

/** Log in as several demo users at once → { admin: token, sales: token, … } */
export async function tokens<K extends keyof typeof USERS>(app: INestApplication, ...who: K[]): Promise<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of who) out[k] = (await login(app, USERS[k])).accessToken;
  return out;
}
