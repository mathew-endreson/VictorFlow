import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { isLikelyAllowed, moveLabel, planDrop, transitionErrorText } from './kanban';

// stand-in for the i18n context: English, server text as it is
const text = { error: (e: unknown) => (e as Error).message, status: (code: string) => code, lookup: (_key: string, fallback: string) => fallback };

const card = (status: string, allowed: Array<{ to: string; requiresNote?: boolean }> = []) => ({
  status,
  allowedTransitions: allowed.map((a) => ({ to: a.to, label: null, requiresNote: a.requiresNote ?? false })),
});

describe('kanban drop planning', () => {
  it('dropping on its own column does nothing', () => {
    expect(planDrop(card('DRAFT', [{ to: 'CONFIRMED' }]), 'DRAFT')).toEqual({ kind: 'noop' });
  });

  it('a permitted move is sent to the server', () => {
    expect(planDrop(card('DRAFT', [{ to: 'CONFIRMED' }]), 'CONFIRMED')).toEqual({ kind: 'send' });
  });

  it('a move known to need a note asks for one first', () => {
    const plan = planDrop(card('QUALITY_CHECK', [{ to: 'REJECTED', requiresNote: true }]), 'REJECTED');
    expect(plan.kind).toBe('ask-note');
  });

  it('an unpermitted / illegal move is STILL sent — the server is the authority and explains the refusal', () => {
    expect(planDrop(card('DRAFT', [{ to: 'CONFIRMED' }]), 'COMPLETED')).toEqual({ kind: 'send' });
    expect(planDrop(card('DRAFT', []), 'CONFIRMED')).toEqual({ kind: 'send' });
  });

  it('column hints reflect only what the user may attempt', () => {
    const c = card('DRAFT', [{ to: 'CONFIRMED' }]);
    expect(isLikelyAllowed(c, 'CONFIRMED')).toBe(true);
    expect(isLikelyAllowed(c, 'COMPLETED')).toBe(false);
  });
});

describe('transitionErrorText', () => {
  it('names the blocking work orders for a failed guard', () => {
    const e = new ApiError(409, '3 of 3 work order(s) are not COMPLETED yet', 'GUARD_FAILED', {
      details: { pending: [{ title: 'Prépresse — ORD-1', status: 'PENDING' }, { title: 'Impression — ORD-1', status: 'IN_PROGRESS' }, { title: 'Finition — ORD-1', status: 'PENDING' }, { title: 'Extra', status: 'PENDING' }] },
    });
    const shown = transitionErrorText(e, text);
    expect(shown).toContain('3 of 3 work order(s) are not COMPLETED yet');
    expect(shown).toContain('Prépresse — ORD-1 (pending)');
    expect(shown.endsWith('…')).toBe(true); // more than three
  });

  it('passes through plain server messages and non-API errors', () => {
    expect(transitionErrorText(new ApiError(409, 'Transition DRAFT → COMPLETED is not allowed', 'ILLEGAL_TRANSITION'), text)).toBe('Transition DRAFT → COMPLETED is not allowed');
    expect(transitionErrorText(new ApiError(403, 'Missing permission: production.order.confirm', 'FORBIDDEN_TRANSITION'), text)).toContain('Missing permission');
    expect(transitionErrorText(new Error('boom'), text)).toBe('boom');
  });
});

describe('moveLabel', () => {
  it('uses the translation of the move when there is one, else the label configured in the database', () => {
    const translated = { ...text, lookup: (key: string, fallback: string) => (key === 'move.CONFIRMED.IN_PRODUCTION' ? 'Start production (translated)' : fallback) };
    expect(moveLabel(translated, 'CONFIRMED', { to: 'IN_PRODUCTION', label: 'Start production' })).toBe('Start production (translated)');
    expect(moveLabel(translated, 'DRAFT', { to: 'CUSTOM_STATE', label: 'Custom label' })).toBe('Custom label');
    expect(moveLabel(translated, 'DRAFT', { to: 'CUSTOM_STATE', label: null })).toBe('CUSTOM_STATE'); // no label at all → the state's own name
  });
});
