import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { DbService } from '../../infra/db/db.service';
import { RedisService } from '../../infra/redis/redis.service';

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
    const body = { status: !db ? 'down' : redis === 'down' ? 'degraded' : 'ok', db: db ? 'up' : 'down', redis, time: new Date().toISOString() };
    if (!db) throw new ServiceUnavailableException(body);
    return body;
  }
}
