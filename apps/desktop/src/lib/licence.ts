import { useQuery } from '@tanstack/react-query';
import type { LicenceSummaryDto, LicenseFeature, OnboardingStep } from '@victorflow/types';
import { api } from './api';
import { useAuth } from './auth';

/** Which modules this server's licence includes, and whether it is read-only — for every signed-in user. */
export function useLicence() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ['licence-summary'],
    queryFn: () => api.get<LicenceSummaryDto>('/license/summary'),
    enabled: status === 'authed',
    staleTime: 60_000,
  });
}

/**
 * Whether a screen of `module` is shown. Unlicensed modules are hidden while the licence is valid (the server refuses
 * them anyway); while it is read-only every screen stays, because reading is always allowed.
 */
export const moduleVisible = (summary: LicenceSummaryDto | undefined, module?: LicenseFeature): boolean =>
  !module || !summary || summary.state === 'read_only' || summary.modules.includes(module);

/** The wizard's steps, in order (the server says which one the install is at). */
export const ONBOARDING_ORDER = ['licence', 'company', 'owner'] as const;

/** How a step is drawn in the step list, given the step the install is at. */
export function stepState(current: OnboardingStep, step: (typeof ONBOARDING_ORDER)[number]): 'done' | 'current' | 'todo' {
  if (current === 'done') return 'done';
  const at = ONBOARDING_ORDER.indexOf(current);
  const i = ONBOARDING_ORDER.indexOf(step);
  return i < at ? 'done' : i === at ? 'current' : 'todo';
}
