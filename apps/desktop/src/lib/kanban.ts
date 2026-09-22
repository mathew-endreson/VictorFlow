import type { AllowedTransitionDto, ProductionCardDto } from '@victorflow/types';
import { ApiError } from './api';

/** The slice of the i18n context the Kanban helpers need (kept small so they stay testable without React). */
export interface KanbanText {
  error: (e: unknown) => string;
  status: (code: string) => string;
  lookup: (key: string, fallback: string) => string;
}

/**
 * Label of a move button / drop dialog. Labels live in the database (config-driven state machine), so they are keyed by
 * the move itself — "move.<from>.<to>" — and an administrator's own transition, which has no translation, keeps its label.
 */
export const moveLabel = (i18n: KanbanText, from: string, t: Pick<AllowedTransitionDto, 'to' | 'label'>): string => i18n.lookup(`move.${from}.${t.to}`, t.label ?? i18n.status(t.to));

/** What dropping `card` on column `to` should do. The SERVER is the authority; this only picks the right UI step. */
export type DropPlan =
  | { kind: 'noop' } //                       dropped back on its own column
  | { kind: 'ask-note'; transition: AllowedTransitionDto } //  the move is known to need a note → collect it first
  | { kind: 'send' }; //                       just ask the server (it will accept or explain why not)

export function planDrop(card: Pick<ProductionCardDto, 'status' | 'allowedTransitions'>, to: string): DropPlan {
  if (card.status === to) return { kind: 'noop' };
  const known = card.allowedTransitions.find((t) => t.to === to);
  if (known?.requiresNote) return { kind: 'ask-note', transition: known };
  // Not in allowedTransitions? Still send it: the point of server-side validation is that the client need not
  // (and must not) be trusted to know the rules — the server's refusal carries the reason worth showing.
  return { kind: 'send' };
}

/** Column hint while dragging: is this move one the current user is permitted to attempt? */
export const isLikelyAllowed = (card: Pick<ProductionCardDto, 'allowedTransitions'>, to: string) => card.allowedTransitions.some((t) => t.to === to);

/** Turn a failed transition into a message worth reading — including WHICH work orders block a guarded move. */
export function transitionErrorText(err: unknown, i18n: Pick<KanbanText, 'error' | 'status'>): string {
  if (!(err instanceof ApiError)) return i18n.error(err);
  const pending = (err.body?.details as { pending?: Array<{ title: string; status: string }> } | undefined)?.pending;
  if (err.code === 'GUARD_FAILED' && pending?.length) {
    const shown = pending.slice(0, 3).map((p) => `${p.title} (${i18n.status(p.status).toLowerCase()})`).join('; ');
    return `${i18n.error(err)}: ${shown}${pending.length > 3 ? '…' : ''}`;
  }
  return i18n.error(err);
}
