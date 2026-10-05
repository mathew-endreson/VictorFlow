import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { LicenseFeature } from '@victorflow/types';
import type { Request } from 'express';
import { LICENCE_EXEMPT, REQUIRED_FEATURE } from '../../common/decorators';
import { LicenseService } from './license.service';

/** Methods that only read: always allowed in read-only mode, so a shop can still view and export everything. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The licence, applied to every route after authentication — but ONLY when LICENSE_ENFORCE=true (always in production).
 *   valid licence  → a route of a module the licence does not include is refused (403 LICENSE_FEATURE), reads too
 *   failed check   → read-only: every read works, whatever the module; every write is refused (403 LICENCE_READ_ONLY)
 * Routes marked @LicenceExempt (sign-in, onboarding, the licence routes) are never blocked.
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
    if (this.reflector.getAllAndOverride<boolean>(LICENCE_EXEMPT, targets)) return true;

    const summary = await this.license.summary();
    if (summary.state === 'read_only') {
      const method = ctx.switchToHttp().getRequest<Request>().method.toUpperCase();
      if (READ_METHODS.has(method)) return true;
      throw new ForbiddenException({
        message: 'The licence check failed, so VictorFlow is read-only: you can view and export, not change anything. The owner can install a valid licence on the Licence screen.',
        code: 'LICENCE_READ_ONLY',
        licenceProblem: summary.problem,
      });
    }

    const feature = this.reflector.getAllAndOverride<LicenseFeature | undefined>(REQUIRED_FEATURE, targets);
    if (feature && !summary.modules.includes(feature)) {
      throw new ForbiddenException({ message: `Your licence does not include the "${feature}" module`, code: 'LICENSE_FEATURE', feature });
    }
    return true;
  }
}
