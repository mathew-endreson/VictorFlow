import { LICENSE_FEATURES, type LicenceSummaryDto } from '@victorflow/types';
import { describe, expect, it } from 'vitest';
import { moduleVisible, ONBOARDING_ORDER, stepState } from './licence';

const active = (modules: LicenceSummaryDto['modules']): LicenceSummaryDto => ({ mode: 'crypto', state: 'active', modules, problem: null });

describe('moduleVisible', () => {
  it('hides the screens of modules a valid licence does not include', () => {
    expect(moduleVisible(active(['crm', 'sales']), 'crm')).toBe(true);
    expect(moduleVisible(active(['crm', 'sales']), 'finance')).toBe(false);
  });

  it('always shows screens that belong to no module, and everything while unknown', () => {
    expect(moduleVisible(active([]), undefined)).toBe(true);
    expect(moduleVisible(undefined, 'finance')).toBe(true);
  });

  it('shows every screen in read-only mode: reading is always allowed', () => {
    expect(moduleVisible({ mode: 'crypto', state: 'read_only', modules: [...LICENSE_FEATURES], problem: 'HARDWARE_MISMATCH' }, 'finance')).toBe(true);
  });
});

describe('onboarding steps', () => {
  it('licence, then company, then owner', () => {
    expect(ONBOARDING_ORDER).toEqual(['licence', 'company', 'owner']);
  });

  it('marks the steps before the current one done, and the ones after it to do', () => {
    expect(ONBOARDING_ORDER.map((s) => stepState('licence', s))).toEqual(['current', 'todo', 'todo']);
    expect(ONBOARDING_ORDER.map((s) => stepState('company', s))).toEqual(['done', 'current', 'todo']);
    expect(ONBOARDING_ORDER.map((s) => stepState('owner', s))).toEqual(['done', 'done', 'current']);
    expect(ONBOARDING_ORDER.map((s) => stepState('done', s))).toEqual(['done', 'done', 'done']);
  });
});
