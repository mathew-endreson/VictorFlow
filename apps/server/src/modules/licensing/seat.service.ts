import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { sql } from '@victorflow/db';
import type { SessionClient } from '@victorflow/types';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { Trx } from '../../infra/db/db.service';
import { LicenseService } from './license.service';

const MIN_IDLE_MS = 30 * 60_000;

/**
 * Licence seats, checked when a session starts (sign-in) and when an idle desktop session comes back:
 *   desktop  sessions open at the same time. A session holds its seat until it signs out, or until it has not renewed
 *            its token for the idle window (max(30 min, 2 × the access-token lifetime)): an open desktop app renews
 *            well inside that, so a PC that was switched off frees its seat on its own.
 *   mobile   people signed in on the mobile app: a user holds one seat while any of their mobile sessions is alive
 *            (the app works offline for days, so its sessions are counted until they expire or sign out).
 * Not counted when enforcement is off, or when there is no valid licence (read-only: signing in to read is always allowed).
 */
@Injectable()
export class SeatService {
  constructor(
    private readonly license: LicenseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** How long a desktop session keeps its seat without renewing its token. */
  idleWindowMs(): number {
    return Math.max(MIN_IDLE_MS, 2 * this.config.jwtAccessTtlSeconds * 1000);
  }

  /**
   * Throws 403 LICENSE_SEATS when starting (or reviving) a session of this kind would go over the licence.
   * Runs inside the transaction that then inserts the session's token: the advisory lock makes concurrent sign-ins
   * take seats one at a time.
   */
  async assertSeat(trx: Trx, who: { client: SessionClient; userId: string; familyId?: string }): Promise<void> {
    if (!this.license.isEnforced()) return;
    const seats = await this.license.seats();
    if (!seats) return;
    await sql`SELECT pg_advisory_xact_lock(hashtext('victorflow.licence.seats'))`.execute(trx);

    const live = trx.selectFrom('core.refresh_tokens').where('revoked_at', 'is', null).where('expires_at', '>', sql<Date>`now()`).where('client', '=', who.client);

    if (who.client === 'desktop') {
      let q = live.where('created_at', '>', new Date(Date.now() - this.idleWindowMs()));
      if (who.familyId) q = q.where('family_id', '<>', who.familyId);
      const { n } = await q.select((eb) => eb.fn.count<string>('family_id').distinct().as('n')).executeTakeFirstOrThrow();
      if (Number(n) >= seats.desktop) throw this.full('desktop', seats.desktop);
      return;
    }

    const mine = await live.select('id').where('user_id', '=', who.userId).limit(1).executeTakeFirst();
    if (mine) return; // this user already holds a mobile seat
    const { n } = await live.select((eb) => eb.fn.count<string>('user_id').distinct().as('n')).executeTakeFirstOrThrow();
    if (Number(n) >= seats.mobile) throw this.full('mobile', seats.mobile);
  }

  private full(kind: SessionClient, limit: number) {
    const what = kind === 'desktop' ? `${limit} desktop session(s) at the same time: sign out on another PC (an unused session frees its seat after ${Math.round(this.idleWindowMs() / 60_000)} minutes)` : `${limit} mobile user(s): another user must sign out of the mobile app first`;
    return new ForbiddenException({ message: `All licence seats are in use — your licence allows ${what}`, code: 'LICENSE_SEATS', kind, limit });
  }
}
