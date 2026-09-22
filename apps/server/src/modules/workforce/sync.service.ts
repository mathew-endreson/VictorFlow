import { Injectable } from '@nestjs/common';
import type { Database, Kysely } from '@victorflow/db';
import { PERMISSIONS, type SyncChange, type SyncMutation, type SyncMutationResult, type SyncPullResponse, type SyncPushDto, type SyncPushResponse } from '@victorflow/types';
import type { Principal } from '../../common/decorators';
import { DbService, type Trx } from '../../infra/db/db.service';
import { ProductionService } from '../production/production.service';
import { TASK_COLUMNS, toProofDto, toTaskDto } from './task.mapper';

/**
 * Offline-first sync for the mobile app.
 *
 *  PUSH  — each mutation is applied in its OWN transaction, in order:
 *          1. claim its idempotency key in workforce.sync_mutations (unique on user + key)
 *             → key already claimed?  return the stored result, apply nothing  ("replayed")
 *          2. optimistic concurrency: UPDATE … WHERE version = baseVersion
 *             → 0 rows?  the row changed since the device read it: return CONFLICT + the server's copy
 *          3. store the outcome next to the claim, in the same transaction
 *          Claim, change and stored result commit together or not at all, so a retry can never double-apply
 *          and never sees "claimed but not applied".
 *
 *  PULL  — a monotonic BIGINT change_seq cursor (never updated_at). A database trigger stamps every insert/update
 *          of a synced row from one sequence, under a lock that makes sequence order == commit order, so a slow
 *          transaction can never be skipped by a client that already moved past its number.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly dbs: DbService,
    private readonly production: ProductionService,
  ) {}

  // ── push ───────────────────────────────────────────────────────────────────

  async push(user: Principal, dto: SyncPushDto): Promise<SyncPushResponse> {
    const results: SyncMutationResult[] = [];
    // Sequential on purpose: a device's mutations to one task are ordered (each rebased on the previous version).
    for (const m of dto.mutations) results.push(await this.applyOne(user, dto.deviceId, m));
    return { results };
  }

  private applyOne(user: Principal, deviceId: string, m: SyncMutation): Promise<SyncMutationResult> {
    return this.dbs.transaction(
      async (trx) => {
        const claimed = await trx
          .insertInto('workforce.sync_mutations')
          .values({ user_id: user.id, idempotency_key: m.idempotencyKey, device_id: deviceId, entity: m.entity, entity_id: m.entityId })
          .onConflict((oc) => oc.columns(['user_id', 'idempotency_key']).doNothing())
          .returning('idempotency_key')
          .executeTakeFirst();

        if (!claimed) {
          // Seen before. A concurrent duplicate blocks on the unique index until the first transaction commits,
          // so by now the stored result is final.
          const prev = await trx
            .selectFrom('workforce.sync_mutations')
            .select(['entity_id', 'response'])
            .where('user_id', '=', user.id)
            .where('idempotency_key', '=', m.idempotencyKey)
            .executeTakeFirstOrThrow();
          if (prev.entity_id !== m.entityId) {
            return { idempotencyKey: m.idempotencyKey, status: 'REJECTED', replayed: true, code: 'IDEMPOTENCY_KEY_REUSED', error: 'This idempotency key was already used for a different task' };
          }
          return { ...(prev.response as unknown as SyncMutationResult), replayed: true };
        }

        const result = await this.applyTaskUpdate(trx, user, m);
        await trx
          .updateTable('workforce.sync_mutations')
          .set({ outcome: result.status, response: JSON.stringify(result) })
          .where('user_id', '=', user.id)
          .where('idempotency_key', '=', m.idempotencyKey)
          .execute();
        return { ...result, replayed: false };
      },
      { actorId: user.id },
    );
  }

  private async applyTaskUpdate(trx: Trx, user: Principal, m: SyncMutation): Promise<Omit<SyncMutationResult, 'replayed'>> {
    const canSeeAll = user.permissions.has(PERMISSIONS.WORKFORCE_TASK_READ_ALL);
    const patch = {
      ...(m.changes.status !== undefined && { status: m.changes.status }),
      ...(m.changes.hoursLogged !== undefined && { hours_logged: m.changes.hoursLogged }),
      ...(m.changes.notes !== undefined && { notes: m.changes.notes }),
    };

    // The version check IS the concurrency control. Under READ COMMITTED a concurrent writer that holds the row
    // makes this statement wait, then re-evaluate the WHERE against the committed row: a stale baseVersion then
    // matches zero rows instead of silently overwriting the other change.
    let update = trx
      .updateTable('workforce.tasks')
      .set(patch)
      .where('id', '=', m.entityId)
      .where('version', '=', m.baseVersion)
      .where('deleted_at', 'is', null);
    if (!canSeeAll) update = update.where('assigned_to', '=', user.id);
    const updated = await update.returning(TASK_COLUMNS).executeTakeFirst();

    if (updated) {
      // A finished field task completes the work order it is linked to (all inside this transaction).
      if (m.changes.status === 'DONE' && updated.work_order_id) await this.production.completeWorkOrder(trx, updated.work_order_id);
      return { idempotencyKey: m.idempotencyKey, status: 'APPLIED', record: toTaskDto(updated) };
    }

    const current = await trx.selectFrom('workforce.tasks').select(TASK_COLUMNS).where('id', '=', m.entityId).executeTakeFirst();
    if (!current || current.deleted_at || (!canSeeAll && current.assigned_to !== user.id)) {
      return { idempotencyKey: m.idempotencyKey, status: 'REJECTED', code: 'NOT_FOUND', error: 'Task not found' };
    }
    return {
      idempotencyKey: m.idempotencyKey,
      status: 'CONFLICT',
      code: 'VERSION_CONFLICT',
      error: `Version conflict: you edited version ${m.baseVersion}, the server has version ${current.version}`,
      serverRecord: toTaskDto(current),
    };
  }

  // ── pull ───────────────────────────────────────────────────────────────────

  async pull(user: Principal, cursor: string, limit: number): Promise<SyncPullResponse> {
    const canSeeAll = user.permissions.has(PERMISSIONS.WORKFORCE_TASK_READ_ALL);
    const db: Kysely<Database> = this.dbs.db;

    // Each table returns its `limit + 1` smallest changes past the cursor; merged and cut at `limit`, that is
    // exactly the next `limit` changes across both tables, in change_seq order.
    let tasksQ = db.selectFrom('workforce.tasks').select(TASK_COLUMNS).where('change_seq', '>', cursor);
    if (!canSeeAll) tasksQ = tasksQ.where('assigned_to', '=', user.id);
    const tasks = await tasksQ.orderBy('change_seq').limit(limit + 1).execute();

    let proofsQ = db
      .selectFrom('workforce.task_proofs as p')
      .innerJoin('workforce.tasks as t', 't.id', 'p.task_id')
      .select(['p.id', 'p.task_id', 'p.mime_type', 'p.size_bytes', 'p.latitude', 'p.longitude', 'p.captured_at', 'p.change_seq'])
      .where('p.change_seq', '>', cursor);
    if (!canSeeAll) proofsQ = proofsQ.where('t.assigned_to', '=', user.id);
    const proofs = await proofsQ.orderBy('p.change_seq').limit(limit + 1).execute();

    const merged: SyncChange[] = [
      ...tasks.map((t): SyncChange =>
        t.deleted_at
          ? { entity: 'task', op: 'delete', changeSeq: t.change_seq, record: { id: t.id } }
          : { entity: 'task', op: 'upsert', changeSeq: t.change_seq, record: toTaskDto(t) },
      ),
      ...proofs.map((p): SyncChange => ({ entity: 'proof', op: 'upsert', changeSeq: p.change_seq, record: toProofDto(p) })),
    ].sort((a, b) => (BigInt(a.changeSeq) < BigInt(b.changeSeq) ? -1 : 1));

    const changes = merged.slice(0, limit);
    return {
      changes,
      nextCursor: changes.length > 0 ? changes[changes.length - 1]!.changeSeq : cursor,
      hasMore: merged.length > limit,
    };
  }
}
