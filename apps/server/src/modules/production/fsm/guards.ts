import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Database, Kysely } from '@victorflow/db';

export interface GuardContext {
  /** The caller's transaction: a guard sees the same snapshot the transition will be applied to. */
  db: Kysely<Database>;
  machine: string;
  entityId: string;
  from: string;
  to: string;
  actorId: string;
  /** guard_params from the transition's DB row — the configuration of THIS use of the guard. */
  params: Record<string, unknown>;
}

export type GuardResult = { ok: true } | { ok: false; message: string; details?: Record<string, unknown> };

/**
 * A guard is a named precondition. The IMPLEMENTATION lives in code (it has to run queries); WHICH transitions
 * use it, and with what parameters, is data in erp.fsm_transitions.guard_code / guard_params.
 */
export interface FsmGuard {
  readonly code: string;
  check(ctx: GuardContext): Promise<GuardResult>;
}

@Injectable()
export class GuardRegistry {
  private readonly guards = new Map<string, FsmGuard>();

  register(guard: FsmGuard): void {
    if (this.guards.has(guard.code)) throw new Error(`Duplicate FSM guard "${guard.code}"`);
    this.guards.set(guard.code, guard);
  }

  get(code: string): FsmGuard | undefined {
    return this.guards.get(code);
  }

  codes(): string[] {
    return [...this.guards.keys()].sort();
  }
}

/**
 * Every (non-cancelled) work order of the production order must be COMPLETED — and there must be at least
 * `minWorkOrders` of them (default 1), so an empty order cannot slip through on a vacuous "all of nothing".
 */
@Injectable()
export class AllWorkOrdersCompletedGuard implements FsmGuard, OnModuleInit {
  readonly code = 'ALL_WORK_ORDERS_COMPLETED';

  constructor(private readonly registry: GuardRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async check(ctx: GuardContext): Promise<GuardResult> {
    const minWorkOrders = typeof ctx.params.minWorkOrders === 'number' ? ctx.params.minWorkOrders : 1;
    const rows = await ctx.db
      .selectFrom('erp.work_orders')
      .select(['title', 'status'])
      .where('production_order_id', '=', ctx.entityId)
      .where('status', '<>', 'CANCELLED')
      .orderBy('created_at')
      .orderBy('title')
      .execute();

    if (rows.length < minWorkOrders) {
      return { ok: false, message: `The production order needs at least ${minWorkOrders} work order(s); it has ${rows.length}`, details: { workOrders: rows.length } };
    }
    const pending = rows.filter((r) => r.status !== 'COMPLETED');
    if (pending.length > 0) {
      return {
        ok: false,
        message: `${pending.length} of ${rows.length} work order(s) are not COMPLETED yet`,
        details: { total: rows.length, pending: pending.map((p) => ({ title: p.title, status: p.status })) },
      };
    }
    return { ok: true };
  }
}
