// licence-issuer — BluxTech only. Never shipped with VictorFlow: no app depends on it, and its private key and ledger
// are refused inside any repository. Run it on the offline BluxTech machine:  node licence-issuer.mjs <command> …
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeLicensePayloadUnverified, isLicensePayload, verifyLicense } from '@victorflow/crypto';
import { keygen, loadLedger, loadPrivateKey, saveLedger, writeLicenceFiles } from './files';
import { createCodes, issueLicence, IssuerError, transferLicence, type Terms } from './issuer';

export const USAGE = `licence-issuer — VictorFlow licences (BluxTech only, never shipped)

  keygen   --out <folder>
           Create BluxTech's key pair (once, on the offline machine). Prints the line for
           packages/crypto/src/licence-public-key.ts. Never overwrites a key.
  codes    --ledger <file> --shop "<shop name>" [--count 1] [--transfers 2]
           New single-use activation codes (VF-XXXX-XXXX-XXXX) for a shop.
  issue    --key <private.pem> --ledger <file> --request <request code>
           --modules crm,sales,… --desktop-seats N --mobile-users M --updates-until YYYY-MM-DD
           [--edition Standard] [--out <folder>] [--reissue]
           The licence for the server that sent the request code. --reissue: the same server again.
  transfer --key <private.pem> --ledger <file> --request <new request code> [--force] [--out <folder>]
           [--modules …] [--desktop-seats N] [--mobile-users M] [--updates-until …] [--edition …]
           The shop's server was replaced: a licence for the new one, same terms unless given.
  inspect  <licence file> [--public-key <public.pem>]
           Show what a licence says (and whether its signature is good, with --public-key).

  The private key and the ledger are refused inside any repository. Licences go to --out
  (default: a "licences" folder next to the ledger) as <licence id>.vfl and .txt.`;

const BOOLEAN = new Set(['reissue', 'force', 'help']);

export function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | true> } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-h') flags.help = true;
    else if (a.startsWith('--')) {
      const name = a.slice(2);
      if (BOOLEAN.has(name)) flags[name] = true;
      else {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw new IssuerError(`--${name} needs a value`);
        flags[name] = v;
      }
    } else positional.push(a);
  }
  return { command: positional.shift() ?? 'help', positional, flags };
}

const str = (flags: Record<string, string | true>, name: string): string | undefined => (typeof flags[name] === 'string' ? (flags[name] as string) : undefined);
function need(flags: Record<string, string | true>, name: string): string {
  const v = str(flags, name);
  if (!v) throw new IssuerError(`--${name} is required (see "licence-issuer help")`);
  return v;
}
function int(flags: Record<string, string | true>, name: string): number | undefined {
  const v = str(flags, name);
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new IssuerError(`--${name} must be a whole number`);
  return Number(v);
}

function termsFrom(flags: Record<string, string | true>): Partial<Terms> {
  const modules = str(flags, 'modules');
  const desktop = int(flags, 'desktop-seats');
  const mobile = int(flags, 'mobile-users');
  return {
    ...(modules !== undefined && { modules: modules.split(',').map((m) => m.trim().toLowerCase()).filter(Boolean) }),
    ...((desktop !== undefined || mobile !== undefined) && { seats: { desktop: desktop as number, mobile: mobile as number } }),
    ...(str(flags, 'updates-until') !== undefined && { updatesUntil: str(flags, 'updates-until') }),
    ...(str(flags, 'edition') !== undefined && { edition: str(flags, 'edition') }),
  };
}

/** Runs one command; returns what to print. Throws IssuerError for anything the user should fix. */
export function run(argv: string[]): string {
  const { command, positional, flags } = parseArgs(argv);
  if (command === 'help' || flags.help) return USAGE;

  switch (command) {
    case 'keygen': {
      const r = keygen(need(flags, 'out'));
      return [
        `Private key: ${r.privateKeyFile}   (keep it on this offline machine and back it up; never copy it into a repository)`,
        `Public key:  ${r.publicKeyFile}`,
        '',
        'Put this line into packages/crypto/src/licence-public-key.ts (LICENCE_PUBLIC_KEY), replacing the placeholder:',
        r.publicKeyLine,
      ].join('\n');
    }

    case 'codes': {
      const ledgerFile = need(flags, 'ledger');
      const ledger = loadLedger(ledgerFile, { create: true });
      const codes = createCodes(ledger, { shop: need(flags, 'shop'), count: int(flags, 'count') ?? 1, transferLimit: int(flags, 'transfers') });
      saveLedger(ledgerFile, ledger);
      return codes.join('\n');
    }

    case 'issue':
    case 'transfer': {
      const ledgerFile = need(flags, 'ledger');
      const key = loadPrivateKey(need(flags, 'key'));
      const ledger = loadLedger(ledgerFile);
      const request = need(flags, 'request');
      const terms = termsFrom(flags);
      const result =
        command === 'issue'
          ? { ...issueLicence(ledger, { request, terms, key, reissue: flags.reissue === true }), note: null as string | null }
          : (() => {
              const t = transferLicence(ledger, { request, terms, key, force: flags.force === true });
              const limit = ledger.codes[t.payload.activationCode]!.transferLimit;
              return { ...t, note: `Transfer ${t.transfersUsed} of ${limit} free${t.transfer.forced ? ' (FORCED beyond the limit)' : ''}: from server ${t.transfer.fromHardwareId.slice(0, 12)}… to ${t.transfer.toHardwareId.slice(0, 12)}…. The old server's licence cannot be revoked offline: it keeps working there.` };
            })();
      const out = str(flags, 'out') ?? path.join(path.dirname(path.resolve(ledgerFile)), 'licences');
      const files = writeLicenceFiles(out, result.payload.licenceId, result.text);
      saveLedger(ledgerFile, ledger); // only once the licence files exist
      const p = result.payload;
      return [
        `${p.licenceId} for "${p.shop}" (${p.activationCode})`,
        `  server ${p.hardwareId}`,
        `  ${p.edition}; desktop ${p.seats.desktop}, mobile ${p.seats.mobile}; modules ${p.modules.join(', ')}; updates until ${p.updatesUntil}`,
        ...(result.note ? [`  ${result.note}`] : []),
        `  files: ${files.vfl}`,
        `         ${files.txt}`,
        '',
        result.text,
      ].join('\n');
    }

    case 'inspect': {
      const file = positional[0];
      if (!file) throw new IssuerError('inspect: name the licence file');
      const text = readFileSync(file, 'utf8');
      const payload = decodeLicensePayloadUnverified(text);
      if (!isLicensePayload(payload)) return `${file}: not a readable VictorFlow licence`;
      const lines = [JSON.stringify(payload, null, 2)];
      const pub = str(flags, 'public-key');
      if (pub) {
        // signature alone: the payload's own hardware id, and a release date its updatesUntil covers
        const v = verifyLicense({ token: text, publicKey: readFileSync(pub, 'utf8'), hardwareId: payload.hardwareId, releaseDate: payload.updatesUntil, now: new Date(payload.issuedAt) });
        lines.push(v.ok ? 'signature: VALID' : `signature: INVALID (${v.code})`);
      } else {
        lines.push('signature: not checked (add --public-key)');
      }
      return lines.join('\n');
    }

    default:
      throw new IssuerError(`unknown command "${command}"\n\n${USAGE}`);
  }
}

/** Whether this file is the script Node was asked to run, whatever it is called (dist/licence-issuer.mjs, the kit's cli.mjs). */
export function invokedDirectly(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  return norm(path.resolve(argv1)) === norm(fileURLToPath(moduleUrl));
}

// Only when executed directly (the tests import run()).
if (invokedDirectly(process.argv[1], import.meta.url)) {
  try {
    console.log(run(process.argv.slice(2)));
  } catch (e) {
    console.error(e instanceof IssuerError ? `licence-issuer: ${e.message}` : e);
    process.exit(e instanceof IssuerError ? 2 : 1);
  }
}
