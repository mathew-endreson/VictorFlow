import { useState } from 'react';
import { Button, Field, Input, Ltr } from '@/components/ui';
import { defaultApiBase, getApiBase, setApiBase } from '@/lib/api';
import { displayHost } from '@/lib/connection';
import { useI18n } from '@/i18n';

/**
 * Which server this client talks to. The API runs on the shop's server computer, so the address must be changeable on
 * every PC: on the sign-in screen, and on the "cannot reach the server" screen. `onSaved` runs after a valid change.
 */
export function ServerAddress({ onSaved }: { onSaved?: (base: string) => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(getApiBase);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [invalid, setInvalid] = useState(false);
  const host = displayHost(current);

  if (!editing) {
    return (
      <p className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-muted">
        <span>{t('login.server')}:</span>
        <Ltr className="tabular font-semibold text-ink/80">{host}</Ltr>
        <button type="button" className="font-semibold text-brandfg hover:underline" onClick={() => { setDraft(current); setInvalid(false); setEditing(true); }}>
          {t('login.serverChange')}
        </button>
      </p>
    );
  }
  const apply = (saved: string | null) => {
    if (!saved) return setInvalid(true);
    setCurrent(saved);
    setDraft(saved);
    setEditing(false);
    onSaved?.(saved);
  };
  return (
    <div className="space-y-2 rounded-md border border-line bg-surface2 p-3 text-start">
      <Field label={t('login.serverLabel')} hint={t('login.serverHint')} error={invalid ? t('login.serverInvalid') : null}>
        {(id) => <Input id={id} dir="ltr" inputMode="url" autoFocus value={draft} onChange={(e) => { setDraft(e.target.value); setInvalid(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(setApiBase(draft)); } }} />}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => apply(setApiBase(null))} disabled={current === defaultApiBase()}>{t('login.serverReset')}</Button>
        <Button size="sm" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
        <Button size="sm" variant="primary" onClick={() => apply(setApiBase(draft))}>{t('common.save')}</Button>
      </div>
    </div>
  );
}
