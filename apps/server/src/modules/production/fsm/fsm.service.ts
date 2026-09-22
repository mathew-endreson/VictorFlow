import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Database, Kysely } from '@victorflow/db';
import type { AllowedTransitionDto, FsmDefinitionDto, FsmStateDto, FsmTransitionDto } from '@victorflow/types';
import type { Principal } from '../../../common/decorators';
import { DbService } from '../../../infra/db/db.service';
import { GuardRegistry } from './guards';

export interface AuthorizeRequest {
  entityId: string;
  from: string;
  to: string;
  actor: Principal;
  note?: string;
}

/** Pure: which configured transitions may this permission set attempt from `from`? */
export function allowedFrom(
  transitions: readonly FsmTransitionDto[],
  from: string,
  permissions: ReadonlySet<string>,
): AllowedTransitionDto[] {
  return transitions
    .filter((t) => t.isActive && t.from === from && permissions.has(t.permissionCode))
    .map((t) => ({ to: t.to, label: t.label, requiresNote: t.requiresNote }));
}

/**
 * Generic, data-driven state machine.
 *
 * Nothing about production orders is hardcoded here. The transition matrix, the permission each transition needs
 * and the guard (with parameters) it runs are all rows in erp.fsm_states / erp.fsm_transitions, loaded on every
 * call — change the rows and the behaviour changes, no deploy. Only guard *implementations* are code.
 *
 * authorize() decides; it does not write. The caller applies the state change in the same transaction, after
 * row-locking the entity, so decision and change are one atomic step.
 */
@Injectable()
export class FsmService {
  private readonly logger = new Logger(FsmService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly guards: GuardRegistry,
  ) {}

  async definition(machine: string, db: Kysely<Database> = this.dbs.db): Promise<FsmDefinitionDto> {
    const m = await db.selectFrom('erp.fsm_machines').select('code').where('code', '=', machine).executeTakeFirst();
    if (!m) throw new NotFoundException(`State machine "${machine}" is not configured`);

    const states = await db.selectFrom('erp.fsm_states').selectAll().where('machine_code', '=', machine).orderBy('position').execute();
    const transitions = await db.selectFrom('erp.fsm_transitions').selectAll().where('machine_code', '=', machine).execute();

    const order = new Map(states.map((s, i) => [s.code, i]));
    const stateDtos: FsmStateDto[] = states.map((s) => ({
      code: s.code,
      label: s.label,
      position: s.position,
      isInitial: s.is_initial,
      isTerminal: s.is_terminal,
      color: s.color,
    }));
    const transitionDtos: FsmTransitionDto[] = transitions
      .map((t) => ({
        id: t.id,
        from: t.from_state,
        to: t.to_state,
        label: t.label,
        permissionCode: t.permission_code,
        guardCode: t.guard_code,
        guardParams: t.guard_params,
        requiresNote: t.requires_note,
        isActive: t.is_active,
      }))
      .sort((a, b) => (order.get(a.from)! - order.get(b.from)!) || (order.get(a.to)! - order.get(b.to)!));

    return { machine, states: stateDtos, transitions: transitionDtos, availableGuards: this.guards.codes() };
  }

  async initialState(machine: string, db: Kysely<Database>): Promise<string> {
    const s = await db.selectFrom('erp.fsm_states').select('code').where('machine_code', '=', machine).where('is_initial', '=', true).executeTakeFirst();
    if (!s) throw new InternalServerErrorException(`State machine "${machine}" has no initial state`);
    return s.code;
  }

  async isTerminal(machine: string, state: string, db: Kysely<Database>): Promise<boolean> {
    const s = await db.selectFrom('erp.fsm_states').select('is_terminal').where('machine_code', '=', machine).where('code', '=', state).executeTakeFirst();
    return s?.is_terminal ?? false;
  }

  /**
   * Decide whether `actor` may move the entity from → to. Throws (nothing is written) unless ALL hold:
   *   1. the transition exists in the matrix and is active                      → 409 ILLEGAL_TRANSITION
   *   2. the actor holds the transition's permission                            → 403 FORBIDDEN_TRANSITION
   *   3. a note is supplied if the transition requires one                      → 422 NOTE_REQUIRED
   *   4. the transition's guard (if any) passes                                 → 409 GUARD_FAILED
   */
  async authorize(db: Kysely<Database>, machine: string, req: AuthorizeRequest) {
    const t = await db
      .selectFrom('erp.fsm_transitions')
      .selectAll()
      .where('machine_code', '=', machine)
      .where('from_state', '=', req.from)
      .where('to_state', '=', req.to)
      .executeTakeFirst();

    if (!t || !t.is_active) {
      throw new ConflictException({ message: `Transition ${req.from} → ${req.to} is not allowed`, code: 'ILLEGAL_TRANSITION' });
    }
    if (!req.actor.permissions.has(t.permission_code)) {
      throw new ForbiddenException({
        message: `Missing permission: ${t.permission_code} (required to move ${req.from} → ${req.to})`,
        code: 'FORBIDDEN_TRANSITION',
      });
    }
    if (t.requires_note && !req.note?.trim()) {
      throw new UnprocessableEntityException({ message: `A note is required to move ${req.from} → ${req.to}`, code: 'NOTE_REQUIRED' });
    }
    if (t.guard_code) {
      const guard = this.guards.get(t.guard_code);
      if (!guard) {
        this.logger.error(`Transition ${t.id} references guard "${t.guard_code}" which is not registered`);
        throw new InternalServerErrorException(`Guard "${t.guard_code}" is configured but not available`);
      }
      const result = await guard.check({
        db,
        machine,
        entityId: req.entityId,
        from: req.from,
        to: req.to,
        actorId: req.actor.id,
        params: t.guard_params,
      });
      if (!result.ok) {
        throw new ConflictException({ message: result.message, code: 'GUARD_FAILED', guard: t.guard_code, ...(result.details && { details: result.details }) });
      }
    }
    return t;
  }

  hasGuard(code: string): boolean {
    return this.guards.get(code) !== undefined;
  }
}
