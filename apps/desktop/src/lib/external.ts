/** True inside the native (Tauri) window, false in a normal browser tab. */
export const inNativeShell = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Open an http(s) address in the person's own browser. A Tauri window ignores `target="_blank"`, so there the opener
 * plugin hands the address to the operating system; in a browser tab it is a normal new tab.
 * Only http(s) is ever opened — the address may come from the server (tracking links), so it is checked, not trusted.
 */
export async function openExternal(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  if (inNativeShell()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(parsed.href);
    return;
  }
  window.open(parsed.href, '_blank', 'noopener,noreferrer');
}
