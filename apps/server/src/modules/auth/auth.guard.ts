import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AUTH_ONLY, IS_PUBLIC, REQUIRED_PERMISSIONS, type Principal } from '../../common/decorators';
import { setCurrentUser } from '../../common/request-context';
import { PermissionsService } from './permissions.service';

export interface AccessTokenClaims {
  sub: string;
  email: string;
}

/**
 * Global guard: authenticate, then authorise by PERMISSION.
 * Default-deny: a route that declares none of @Public / @Authenticated / @RequirePermissions is refused,
 * so forgetting a decorator fails closed instead of exposing an endpoint.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: Principal }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, { issuer: 'victorflow' });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const principal = await this.permissions.loadPrincipal(claims.sub);
    if (!principal) throw new UnauthorizedException('Account is disabled or no longer exists');

    req.user = principal;
    setCurrentUser(principal.id); // → audit actor for every write in this request

    if (this.reflector.getAllAndOverride<boolean>(AUTH_ONLY, targets)) return true;

    const required = this.reflector.getAllAndMerge<string[]>(REQUIRED_PERMISSIONS, targets);
    if (required.length === 0) {
      throw new ForbiddenException('This endpoint declares no required permission and is denied by default');
    }
    const missing = required.filter((p) => !principal.permissions.has(p));
    if (missing.length > 0) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}
