import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { LicenseFeature } from '@victorflow/types';
import { IS_PUBLIC, REQUIRED_FEATURE } from '../../common/decorators';
import { LicenseService } from './license.service';

/**
 * Blocks routes whose module the licence does not include — but ONLY when LICENSE_ENFORCE=true.
 * With enforcement off (the default for local development) this guard is a no-op, whatever the licence says.
 * Unauthenticated / public routes and the licence status endpoint itself are never gated.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly license: LicenseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.license.isEnforced()) return true;

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const feature = this.reflector.getAllAndOverride<LicenseFeature | undefined>(REQUIRED_FEATURE, targets);
    if (!feature) return true; // not a licensed module (auth, users, licence status, health …)

    const entitlement = await this.license.getEntitlement();
    if (!entitlement) {
      const status = await this.license.status();
      throw new ForbiddenException({
        message: `No valid licence: ${status.problem?.message ?? 'unknown problem'}`,
        code: 'LICENSE_INVALID',
        licenseProblem: status.problem?.code,
      });
    }
    if (!entitlement.features.includes(feature)) {
      throw new ForbiddenException({
        message: `Your ${entitlement.tier} licence does not include the "${feature}" module`,
        code: 'LICENSE_FEATURE',
        feature,
      });
    }
    return true;
  }
}
