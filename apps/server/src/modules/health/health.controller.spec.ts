import { ServiceUnavailableException } from '@nestjs/common';
import type { DbService } from '../../infra/db/db.service';
import type { RedisService } from '../../infra/redis/redis.service';
import { HEALTH_SERVICE, HealthController } from './health.controller';

const controller = (dbUp: boolean, redis: { enabled: boolean; isReady: boolean } = { enabled: false, isReady: false }) =>
  new HealthController({ ping: async () => dbUp } as unknown as DbService, redis as unknown as RedisService);

describe('HealthController', () => {
  it('names the service, so a client can tell VictorFlow from anything else on that port', async () => {
    await expect(controller(true).check()).resolves.toMatchObject({ service: HEALTH_SERVICE, status: 'ok', db: 'up', redis: 'disabled' });
  });

  it('answers 503 with the same named body when the database is down', async () => {
    const err = await controller(false)
      .check()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({ service: HEALTH_SERVICE, status: 'down', db: 'down' });
  });

  it('reports degraded when Redis is configured but unreachable', async () => {
    await expect(controller(true, { enabled: true, isReady: false }).check()).resolves.toMatchObject({ status: 'degraded', redis: 'down' });
  });
});
