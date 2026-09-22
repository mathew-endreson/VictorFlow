import { Injectable } from '@nestjs/common';
import type { Principal } from '../../common/decorators';
import { DbService } from '../../infra/db/db.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly dbs: DbService) {}

  /**
   * Loads the caller's roles and effective permissions straight from the DB on every request, so a change
   * to a role or a deactivated account takes effect immediately (no stale claims baked into a JWT).
   * MVP-NOTE: two small indexed queries per request; add a short-TTL cache (Redis) if this ever shows up in profiles.
   */
  async loadPrincipal(userId: string): Promise<Principal | null> {
    const user = await this.dbs.db
      .selectFrom('core.users')
      .select(['id', 'email', 'full_name', 'is_active'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || !user.is_active) return null;

    const roles = await this.dbs.db
      .selectFrom('core.user_roles as ur')
      .innerJoin('core.roles as r', 'r.id', 'ur.role_id')
      .select('r.code')
      .where('ur.user_id', '=', userId)
      .execute();

    const perms = await this.dbs.db
      .selectFrom('core.user_roles as ur')
      .innerJoin('core.role_permissions as rp', 'rp.role_id', 'ur.role_id')
      .innerJoin('core.permissions as p', 'p.id', 'rp.permission_id')
      .select('p.code')
      .distinct()
      .where('ur.user_id', '=', userId)
      .execute();

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      roles: roles.map((r) => r.code).sort(),
      permissions: new Set(perms.map((p) => p.code)),
    };
  }
}
