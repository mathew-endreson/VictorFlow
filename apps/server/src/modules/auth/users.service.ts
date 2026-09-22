import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from '@victorflow/db';
import { PERMISSIONS, type CreateUserDto, type RoleSummary, type UpdateUserDto, type UserSummary } from '@victorflow/types';
import type { Principal } from '../../common/decorators';
import { DbService, type Trx } from '../../infra/db/db.service';
import { LicenseService } from '../licensing/license.service';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

@Injectable()
export class UsersService {
  constructor(
    private readonly dbs: DbService,
    private readonly auth: AuthService,
    private readonly license: LicenseService,
  ) {}

  async list(): Promise<UserSummary[]> {
    const users = await this.dbs.db
      .selectFrom('core.users')
      .select(['id', 'email', 'full_name', 'is_active', 'last_login_at'])
      .orderBy('full_name')
      .execute();
    const roles = await this.dbs.db
      .selectFrom('core.user_roles as ur')
      .innerJoin('core.roles as r', 'r.id', 'ur.role_id')
      .select(['ur.user_id', 'r.code'])
      .execute();
    return users.map((u) => this.toSummary(u, roles.filter((r) => r.user_id === u.id).map((r) => r.code)));
  }

  /** A person may hand out roles, but never permissions they do not hold themselves. */
  async create(dto: CreateUserDto, actor: Principal): Promise<UserSummary> {
    if (this.license.isEnforced()) {
      const { n } = await this.dbs.db.selectFrom('core.users').select((eb) => eb.fn.countAll<string>().as('n')).where('is_active', '=', true).executeTakeFirstOrThrow();
      if (!(await this.license.canAddUser(Number(n)))) {
        throw new ForbiddenException({ message: 'Your licence does not allow more active users', code: 'LICENSE_SEATS' });
      }
    }
    const passwordHash = await hashPassword(dto.password); // outside the tx: CPU-bound
    return this.dbs.transaction(async (trx) => {
      const roleIds = await this.resolveRoles(trx, dto.roles);
      await this.assertMayGrant(trx, actor, roleIds);
      const user = await trx
        .insertInto('core.users')
        .values({ email: dto.email, full_name: dto.fullName, password_hash: passwordHash })
        .returning(['id', 'email', 'full_name', 'is_active', 'last_login_at'])
        .executeTakeFirstOrThrow();
      await trx.insertInto('core.user_roles').values(roleIds.map((role_id) => ({ user_id: user.id, role_id }))).execute();
      return this.toSummary(user, dto.roles);
    });
  }

  async update(id: string, dto: UpdateUserDto, actor: Principal): Promise<UserSummary> {
    if (dto.isActive === false && id === actor.id) throw new BadRequestException('You cannot deactivate your own account');
    const passwordHash = dto.password ? await hashPassword(dto.password) : undefined;

    return this.dbs.transaction(async (trx) => {
      // one user-admin change at a time: the "someone can still manage users" check below must see a settled picture
      await sql`SELECT pg_advisory_xact_lock(hashtext('victorflow.users.admin'))`.execute(trx);
      const exists = await trx.selectFrom('core.users').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!exists) throw new NotFoundException('User not found');
      await this.assertMayManage(trx, actor, id);

      const patch = {
        ...(dto.fullName !== undefined && { full_name: dto.fullName }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
        ...(passwordHash !== undefined && { password_hash: passwordHash }),
      };
      if (Object.keys(patch).length > 0) await trx.updateTable('core.users').set(patch).where('id', '=', id).execute();

      if (dto.roles) {
        const roleIds = await this.resolveRoles(trx, dto.roles);
        await this.assertMayGrant(trx, actor, roleIds);
        await trx.deleteFrom('core.user_roles').where('user_id', '=', id).execute();
        await trx.insertInto('core.user_roles').values(roleIds.map((role_id) => ({ user_id: id, role_id }))).execute();
      }
      if (dto.isActive === false || passwordHash) await this.auth.revokeAllSessions(trx, id);
      if (dto.roles !== undefined || dto.isActive !== undefined) await this.assertSomeoneCanManageUsers(trx);

      const user = await trx
        .selectFrom('core.users')
        .select(['id', 'email', 'full_name', 'is_active', 'last_login_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const roles = await trx
        .selectFrom('core.user_roles as ur')
        .innerJoin('core.roles as r', 'r.id', 'ur.role_id')
        .select('r.code')
        .where('ur.user_id', '=', id)
        .execute();
      return this.toSummary(user, roles.map((r) => r.code));
    });
  }

  async listRoles(): Promise<RoleSummary[]> {
    const roles = await this.dbs.db.selectFrom('core.roles').select(['id', 'code', 'name']).orderBy('name').execute();
    const perms = await this.dbs.db
      .selectFrom('core.role_permissions as rp')
      .innerJoin('core.permissions as p', 'p.id', 'rp.permission_id')
      .select(['rp.role_id', 'p.code'])
      .execute();
    return roles.map((r) => ({
      ...r,
      permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.code).sort(),
    }));
  }

  /** The permissions a set of roles carries, that `actor` does not hold. */
  private async permissionsBeyond(trx: Trx, actor: Principal, where: { roleIds: string[] } | { userId: string }): Promise<string[]> {
    const q = trx.selectFrom('core.role_permissions as rp').innerJoin('core.permissions as p', 'p.id', 'rp.permission_id').select('p.code').distinct();
    const rows =
      'roleIds' in where
        ? await q.where('rp.role_id', 'in', where.roleIds).execute()
        : await q.innerJoin('core.user_roles as ur', 'ur.role_id', 'rp.role_id').where('ur.user_id', '=', where.userId).execute();
    return rows.map((r) => r.code).filter((code) => !actor.permissions.has(code));
  }

  private async assertMayGrant(trx: Trx, actor: Principal, roleIds: string[]): Promise<void> {
    const beyond = await this.permissionsBeyond(trx, actor, { roleIds });
    if (beyond.length > 0) {
      throw new ForbiddenException({ message: `You cannot grant permissions you do not hold yourself: ${beyond.slice(0, 5).join(', ')}`, code: 'ROLE_ESCALATION' });
    }
  }

  /** Nobody can change (reset the password of, disable, re-role) a user who holds more power than they do. */
  private async assertMayManage(trx: Trx, actor: Principal, userId: string): Promise<void> {
    if (userId === actor.id) return;
    const beyond = await this.permissionsBeyond(trx, actor, { userId });
    if (beyond.length > 0) {
      throw new ForbiddenException({ message: 'You cannot change a user who holds permissions you do not have', code: 'USER_OUT_OF_REACH' });
    }
  }

  /** Never leave the installation without an active user who can manage users (nobody could ever fix it). */
  private async assertSomeoneCanManageUsers(trx: Trx): Promise<void> {
    const { n } = await trx
      .selectFrom('core.users as u')
      .innerJoin('core.user_roles as ur', 'ur.user_id', 'u.id')
      .innerJoin('core.role_permissions as rp', 'rp.role_id', 'ur.role_id')
      .innerJoin('core.permissions as p', 'p.id', 'rp.permission_id')
      .where('u.is_active', '=', true)
      .where('p.code', '=', PERMISSIONS.CORE_USER_MANAGE)
      .select((eb) => eb.fn.count<string>('u.id').distinct().as('n'))
      .executeTakeFirstOrThrow();
    if (Number(n) === 0) {
      throw new ConflictException({ message: 'At least one active user must keep the right to manage users', code: 'LAST_ADMIN' });
    }
  }

  private async resolveRoles(trx: Trx, codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    const found = await trx.selectFrom('core.roles').select(['id', 'code']).where('code', 'in', unique).execute();
    const missing = unique.filter((c) => !found.some((f) => f.code === c));
    if (missing.length > 0) {
      throw new UnprocessableEntityException({ message: `Unknown role(s): ${missing.join(', ')}`, code: 'UNKNOWN_ROLE' });
    }
    return found.map((f) => f.id);
  }

  private toSummary(
    u: { id: string; email: string; full_name: string; is_active: boolean; last_login_at: Date | null },
    roles: string[],
  ): UserSummary {
    return {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      isActive: u.is_active,
      roles: [...roles].sort(),
      lastLoginAt: u.last_login_at ? u.last_login_at.toISOString() : null,
    };
  }
}
