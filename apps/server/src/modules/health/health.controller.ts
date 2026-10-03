import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { DbService } from '../../infra/db/db.service';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * Names this API in every health answer. The desktop client checks it before trusting an address, so "something else
 * answers on that port" is told apart from "the VictorFlow server is down".
 */
export const HEALTH_SERVICE = 'victorflow-api';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dbs: DbService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check() {
    const db = await this.dbs.ping();
    // Redis is an accelerator: configured-but-unreachable is "degraded" (still serving, limits/jobs run in-process), and
    // switched off on purpose is just "disabled".
    const redis = !this.redis.enabled ? 'disabled' : this.redis.isReady ? 'up' : 'down';
    const body = { service: HEALTH_SERVICE, status: !db ? 'down' : redis === 'down' ? 'degraded' : 'ok', db: db ? 'up' : 'down', redis, time: new Date().toISOString() };
    if (!db) throw new ServiceUnavailableException(body);
    return body;
  }
}
