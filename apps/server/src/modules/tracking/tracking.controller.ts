import { Controller, Get, Header, HttpException, HttpStatus, Ip, Param } from '@nestjs/common';
import { PERMISSIONS, type PublicTrackingDto, type TrackingLinkDto } from '@victorflow/types';
import { Public, RequirePermissions } from '../../common/decorators';
import { IdParam } from '../../common/zod.pipe';
import { RateLimitService } from '../../infra/redis/rate-limit.service';
import { TrackingService } from './tracking.service';

/** No authentication: the unguessable HMAC in the URL is the credential. Read-only and sanitised. */
@Controller('public')
export class PublicTrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Get('track/:orderId/:token')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async track(@Param('orderId') orderId: string, @Param('token') token: string, @Ip() ip: string): Promise<PublicTrackingDto> {
    // Slow down anyone probing for valid links (in-process counter if Redis is down).
    const limit = await this.rateLimit.hit(`track:${ip}`, 60, 60);
    if (!limit.allowed) {
      throw new HttpException({ message: 'Too many requests', code: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    // Params are deliberately NOT zod-validated: a malformed id must look exactly like a wrong token (404), not a 400.
    return this.tracking.resolve(orderId, token);
  }
}

@Controller('orders')
export class OrderTrackingLinkController {
  constructor(private readonly tracking: TrackingService) {}

  @RequirePermissions(PERMISSIONS.SALES_ORDER_READ)
  @Get(':id/tracking-link')
  link(@IdParam() id: string): Promise<TrackingLinkDto> {
    return this.tracking.linkFor(id);
  }
}
