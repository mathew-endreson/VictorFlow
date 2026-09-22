import type { Translator } from './core';

/** The parts of a failed API call that matter for wording (both the desktop and the mobile `ApiError` satisfy this). */
export interface ErrorLike {
  status?: number;
  code?: string;
  message: string;
}

const STATUS_KEY: Array<[test: (s: number) => boolean, key: string]> = [
  [(s) => s === 401, 'error.unauthorized'],
  [(s) => s === 403, 'error.forbidden'],
  [(s) => s === 404, 'error.notFound'],
  [(s) => s === 429, 'error.rateLimited'],
  [(s) => s >= 500, 'error.server'],
];

/**
 * The text to show for a failed API call.
 *
 * The server writes its messages in English. In English they are shown as they are — they are specific ("Order ORD-…
 * is invoiced"). In any other language the stable `code` (or, failing that, the HTTP status) is translated instead,
 * and the English server text is only a last resort for a rule that has no translation yet.
 */
export function localizeError(tr: Translator<string>, e: ErrorLike): string {
  if (e.code === 'NETWORK') return tr.t('error.network');
  if (tr.locale === 'en' && e.message) return e.message;
  if (e.code && tr.has(`error.code.${e.code}`)) return tr.t(`error.code.${e.code}`);
  const byStatus = e.status === undefined ? undefined : STATUS_KEY.find(([test]) => test(e.status!))?.[1];
  if (byStatus) return tr.t(byStatus);
  return e.message || tr.t('error.unknown');
}
