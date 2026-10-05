import { useQuery } from '@tanstack/react-query';
import type { OnboardingStatusDto } from '@victorflow/types';
import { useEffect, useState, type ReactNode } from 'react';
import { Loading } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { Onboarding } from '@/pages/Onboarding';

/**
 * A server nobody has set up yet shows the onboarding (licence → company → owner) instead of the sign-in screen.
 * Once the server says "done" it is never asked again in this session (signing in and out clears the query cache).
 * If the question cannot be answered, the app carries on as before: the sign-in screen explains connection problems.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const q = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => api.anonGet<OnboardingStatusDto>('/onboarding'),
    enabled: !done,
    staleTime: Infinity,
    retry: 1,
  });
  useEffect(() => {
    if (q.data?.step === 'done') setDone(true);
  }, [q.data]);

  if (done || q.isError || q.data?.step === 'done') return <>{children}</>;
  if (!q.data) return <Loading label={t('app.restoring')} />;
  return <Onboarding status={q.data} onDone={() => setDone(true)} />;
}
