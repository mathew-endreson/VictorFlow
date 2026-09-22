import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, LoginDto, LoginResponse } from '@victorflow/types';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { Principal } from '../../common/decorators';
import { DbService, type Trx } from '../../infra/db/db.service';
import { RateLimitService } from '../../infra/redis/rate-limit.service';
import { PermissionsService } from './permissions.service';
import { hashPassword, verifyPassword } from './password';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const LOGIN_WINDOW_SECONDS = 15 * 60;

export const toAuthUser = (p: Principal): AuthUser => ({
  id: p.id,
  email: p.email,
  fullName: p.fullName,
  roles: p.roles,
  permissions: [...p.permissions].sort(),
});

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown, so "no such user" costs the same as "wrong password". */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly dbs: DbService,
    private readonly jwt: JwtService,
    private readonly permissions: PermissionsService,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(dto: LoginDto, meta: ClientMeta): Promise<LoginResponse> {
    const email = dto.email.trim().toLowerCase();

    const limit = await this.rateLimit.hit(`login:${meta.ip ?? 'unknown'}:${email}`, this.config.loginMaxAttempts, LOGIN_WINDOW_SECONDS);
    if (!limit.allowed) {
      throw new HttpException(
        { message: `Too many login attempts. Try again in ${limit.retryAfterSeconds}s.`, code: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.dbs.db
      .selectFrom('core.users')
      .select(['id', 'password_hash', 'is_active'])
      .where((eb) => eb(eb.fn('lower', ['email']), '=', email))
      .executeTakeFirst();

    const passwordOk = user
      ? await verifyPassword(user.password_hash, dto.password)
      : (await verifyPassword(await this.getDummyHash(), dto.password), false);

    if (!user || !passwordOk || !user.is_active) throw new UnauthorizedException('Invalid email or password');

    return this.dbs.transaction(
      async (trx) => {
        await trx.updateTable('core.users').set({ last_login_at: new Date() }).where('id', '=', user.id).execute();
        return this.startSession(trx, user.id, randomUUID(), meta);
      },
      { actorId: user.id },
    );
  }

  async refresh(refreshToken: string, meta: ClientMeta): Promise<LoginResponse> {
    const hash = sha256hex(refreshToken);

    // Decide inside the transaction, throw AFTER it commits — otherwise revoking a stolen token's family
    // would be rolled back by the very exception that reports the theft.
    const outcome = await this.dbs.transaction(
      async (trx) => {
        const row = await trx.selectFrom('core.refresh_tokens').selectAll().where('token_hash', '=', hash).forUpdate().executeTakeFirst();
        if (!row) return { kind: 'invalid' } as const;

        if (row.revoked_at) {
          // An already-rotated token is being replayed: assume theft, kill the whole family.
          await trx
            .updateTable('core.refresh_tokens')
            .set({ revoked_at: new Date() })
            .where('family_id', '=', row.family_id)
            .where('revoked_at', 'is', null)
            .execute();
          return { kind: 'reuse' } as const;
        }
        if (row.expires_at.getTime() <= Date.now()) return { kind: 'expired' } as const;

        const session = await this.startSession(trx, row.user_id, row.family_id, meta, row.id);
        return { kind: 'ok', session } as const;
      },
      { actorId: null },
    );

    switch (outcome.kind) {
      case 'ok':
        return outcome.session;
      case 'reuse':
        throw new UnauthorizedException('Refresh token was already used; the session has been revoked');
      case 'expired':
        throw new UnauthorizedException('Refresh token has expired');
      default:
        throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /** Revokes the whole session family of this refresh token. Idempotent; unknown tokens are ignored. */
  async logout(refreshToken: string): Promise<void> {
    const hash = sha256hex(refreshToken);
    await this.dbs.transaction(
      async (trx) => {
        const row = await trx.selectFrom('core.refresh_tokens').select('family_id').where('token_hash', '=', hash).executeTakeFirst();
        if (!row) return;
        await trx
          .updateTable('core.refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('family_id', '=', row.family_id)
          .where('revoked_at', 'is', null)
          .execute();
      },
      { actorId: null },
    );
  }

  /** Revoke every session of a user (used when an account is disabled or its password changes). */
  async revokeAllSessions(trx: Trx, userId: string): Promise<void> {
    await trx
      .updateTable('core.refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  private async startSession(trx: Trx, userId: string, familyId: string, meta: ClientMeta, rotateFromId?: string): Promise<LoginResponse> {
    const principal = await this.permissions.loadPrincipal(userId);
    if (!principal) throw new UnauthorizedException('Account is disabled or no longer exists');

    const refreshToken = randomBytes(32).toString('base64url');
    const inserted = await trx
      .insertInto('core.refresh_tokens')
      .values({
        user_id: userId,
        family_id: familyId,
        token_hash: sha256hex(refreshToken),
        expires_at: new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000),
        user_agent: meta.userAgent?.slice(0, 300) ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (rotateFromId) {
      await trx
        .updateTable('core.refresh_tokens')
        .set({ revoked_at: new Date(), replaced_by: inserted.id })
        .where('id', '=', rotateFromId)
        .execute();
    }

    const accessToken = await this.jwt.signAsync({ sub: principal.id, email: principal.email });
    return { accessToken, refreshToken, expiresIn: this.config.jwtAccessTtlSeconds, user: toAuthUser(principal) };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }
}
