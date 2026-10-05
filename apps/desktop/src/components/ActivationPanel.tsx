import { formatActivationCode, isValidActivationCode, type LicenceRequestDto } from '@victorflow/types';
import { Check, Copy, FileUp, Globe } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, Eyebrow, Field, Input, Textarea } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';

/** Where the panel sends things: the onboarding's public routes, or the licence routes of a signed-in owner. */
export interface ActivationTransport {
  request: (code: string) => Promise<LicenceRequestDto>;
  install: (licence: string) => Promise<unknown>;
  online: (code: string) => Promise<unknown>;
}

/**
 * Offline activation (the default): activation code → request code to send to BluxTech → paste the licence text, or
 * open the .vfl file. Online activation is offered only when the server has a licence server address.
 */
export function ActivationPanel({ transport, online, initialCode, onInstalled }: { transport: ActivationTransport; online: boolean; initialCode?: string | null; onInstalled: () => void }) {
  const { t, lookup, error: errorText } = useI18n();
  const [code, setCode] = useState(initialCode ?? '');
  const [request, setRequest] = useState<LicenceRequestDto | null>(null);
  const [licence, setLicence] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'request' | 'install' | 'online' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const codeOk = isValidActivationCode(code);
  const codeError = code.replace(/[^0-9a-z]/gi, '').length >= 12 && !codeOk ? t('activation.codeInvalid') : null;

  /** A rejected licence says exactly why (wrong server, changed, updates expired …). */
  const explain = (e: unknown) =>
    e instanceof ApiError && e.code === 'LICENCE_REJECTED' && typeof e.body?.licenceProblem === 'string'
      ? lookup(`license.problem.${e.body.licenceProblem}`, errorText(e))
      : errorText(e);

  async function run(kind: 'request' | 'install' | 'online', fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  }

  async function openFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setLicence(await f.text());
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <Field label={t('activation.codeLabel')} hint={t('activation.codeHint')} error={codeError}>
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                className="font-mono uppercase tracking-wider"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onBlur={() => codeOk && setCode(formatActivationCode(code))}
                data-testid="activation-code"
              />
            )}
          </Field>
        </div>
        <Button disabled={!codeOk} loading={busy === 'request'} onClick={() => run('request', async () => setRequest(await transport.request(code)))}>
          {t('activation.getRequest')}
        </Button>
        {online && (
          <Button disabled={!codeOk} loading={busy === 'online'} onClick={() => run('online', async () => { await transport.online(code); onInstalled(); })}>
            <Globe aria-hidden className="size-4" />
            {t('activation.online')}
          </Button>
        )}
      </div>
      {online && <p className="-mt-3 text-xs text-muted">{t('activation.onlineHelp')}</p>}

      {request && (
        <div className="rounded-md border border-line bg-surface2 p-4">
          <Eyebrow>{t('activation.requestTitle')}</Eyebrow>
          <div className="flex flex-wrap items-start gap-3">
            <code dir="ltr" data-testid="request-code" className="min-w-0 flex-1 select-all break-all font-mono text-sm leading-relaxed">{request.requestCode}</code>
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard?.writeText(request.requestCode).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
              {copied ? t('activation.copied') : t('activation.copy')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">{t('activation.requestHelp')}</p>
        </div>
      )}

      <Field label={t('activation.licenceLabel')} hint={t('activation.licenceHint')}>
        {(id) => <Textarea id={id} dir="ltr" rows={6} spellCheck={false} className="font-mono text-xs" value={licence} onChange={(e) => setLicence(e.target.value)} data-testid="licence-text" />}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <input ref={file} type="file" hidden accept=".vfl,.txt,text/plain" onChange={openFile} aria-label={t('activation.openFile')} />
        <Button onClick={() => file.current?.click()}>
          <FileUp aria-hidden className="size-4" />
          {t('activation.openFile')}
        </Button>
        <Button variant="primary" disabled={!licence.trim()} loading={busy === 'install'} onClick={() => run('install', async () => { await transport.install(licence); setLicence(''); onInstalled(); })}>
          {t('activation.install')}
        </Button>
      </div>
      {error && <p role="alert" className="rounded-md border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
