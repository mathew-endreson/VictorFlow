import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { remove } from './control';
import { VfError } from './errors';
import { dataLayout, INSTALL_INFO } from './layout';
import { setup } from './setup';
import { fakeHost, tempInstall } from './testing/fake-host';
import { PG_INCLUDE_LINE } from './windows';

const codeOf = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (e instanceof VfError ? e.code : String(e)));

describe('vf-server setup — first install', () => {
  it('locks the data folder, creates the cluster with the installing user granted for initdb only, then registers and starts everything in order', async () => {
    const { layout, dataDir } = tempInstall();
    const host = fakeHost();
    const addresses = await setup({ layout, dataDir, services: true }, host);
    const data = dataLayout(dataDir);
    const ev = host.events;
    const at = (needle: string) => ev.findIndex((e) => e === needle || e.startsWith(needle));

    // the data folder is locked down before anything is written into it that matters
    const icacls = host.calls.filter((c) => c.cmd === 'icacls.exe');
    expect(icacls[0]!.args).toEqual([dataDir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-20:(OI)(CI)M']);
    // initdb runs between a grant to the installing user's SID and its removal
    expect(icacls[1]!.args).toEqual([data.postgres, '/grant', '*S-1-5-21-111-222-333-1001:(OI)(CI)F']);
    expect(icacls[2]!.args).toEqual([data.postgres, '/remove:g', '*S-1-5-21-111-222-333-1001']);
    const initdb = host.calls.find((c) => /initdb/i.test(c.cmd))!;
    expect(host.calls.indexOf(icacls[1]!)).toBeLessThan(host.calls.indexOf(initdb));
    expect(host.calls.indexOf(initdb)).toBeLessThan(host.calls.indexOf(icacls[2]!));

    expect(initdb.args).toContain('--auth=scram-sha-256');
    expect(initdb.args.find((a) => a.startsWith('--pwfile='))).not.toContain(dataDir); // never written into the locked folder
    expect(existsSync(initdb.args.find((a) => a.startsWith('--pwfile='))!.slice('--pwfile='.length))).toBe(false); // and gone afterwards

    // PostgreSQL is a service before the database is prepared; the database is ready before the API starts
    expect(at('pg_ctl register')).toBeGreaterThan(at('initdb'));
    expect(at('prepareDatabase')).toBeGreaterThan(at('pg_ctl register'));
    expect(ev.indexOf('prepareDatabase')).toBeLessThan(ev.indexOf('waitApi 3000'));
    for (const id of ['VictorFlowApi', 'VictorFlowTracker', 'VictorFlowDisplay']) {
      expect(host.installed.has(id), id).toBe(true);
      expect(host.calls).toContainEqual({ cmd: 'sc.exe', args: ['config', id, 'obj=', 'NT AUTHORITY\\NetworkService', 'password=', ''] });
    }
    expect(host.installed.has('VictorFlowPostgres')).toBe(true);
    expect(ev).toEqual(expect.arrayContaining(['waitApi 3000', 'waitWeb 3001', 'waitWeb 3002']));

    // firewall: stale rules removed, then API / tracker / displays opened to node.exe on private + domain networks only
    const netsh = host.calls.filter((c) => c.cmd === 'netsh.exe').map((c) => c.args.find((a) => a.startsWith('localport='))!);
    expect(netsh).toEqual(['localport=3000', 'localport=3001', 'localport=3002']);
    expect(host.calls.find((c) => c.cmd === 'netsh.exe')!.args).toContain('profile=private,domain');

    // files
    expect(readFileSync(path.join(data.postgres, 'postgresql.conf'), 'utf8')).toContain(PG_INCLUDE_LINE);
    expect(readFileSync(path.join(data.postgres, 'victorflow.conf'), 'utf8')).toMatch(/port = 55432[\s\S]*listen_addresses = '127.0.0.1'/);
    expect(JSON.parse(readFileSync(path.join(layout.root, INSTALL_INFO), 'utf8'))).toEqual({ dataDir });
    const secrets = JSON.parse(readFileSync(data.secrets, 'utf8')) as Record<string, string>;
    for (const id of ['VictorFlowApi', 'VictorFlowTracker', 'VictorFlowDisplay']) {
      const xml = readFileSync(path.join(layout.servicesDir, `${id}.xml`), 'utf8');
      for (const secret of Object.values(secrets)) expect(xml, `${id} must carry no secret`).not.toContain(secret);
    }
    expect(readFileSync(data.firstLogin, 'utf8')).toContain(secrets.adminPassword);
    // ordinary users may read the two files without secrets (so `vf-server status` works unelevated) — and nothing else
    const usersRead = host.calls.filter((c) => c.cmd === 'icacls.exe' && c.args.includes('*S-1-5-32-545:R')).map((c) => c.args[0]);
    expect(usersRead).toEqual([data.config, data.addresses]);
    expect(readFileSync(data.addresses, 'utf8')).toContain('api=192.168.1.10:3000');
    expect(addresses).toMatchObject({ api: '192.168.1.10:3000', tracker: 'http://192.168.1.10:3001', display: 'http://192.168.1.10:3002', publicNetwork: false });
  });

  it('warns in addresses.ini when the network is "Public" (Windows would block every other PC)', async () => {
    const { layout, dataDir } = tempInstall();
    const addresses = await setup({ layout, dataDir, services: true }, fakeHost({ publicNetwork: true }));
    expect(addresses.publicNetwork).toBe(true);
    expect(readFileSync(dataLayout(dataDir).addresses, 'utf8')).toContain('publicNetwork=1');
  });
});

describe('vf-server setup — run again (upgrade, or after editing config.json)', () => {
  it('keeps secrets and the cluster, never re-locks the folder or re-registers services, rewrites the WinSW files, applies new ports', async () => {
    const { layout, dataDir } = tempInstall();
    const first = fakeHost();
    await setup({ layout, dataDir, services: true }, first);
    const data = dataLayout(dataDir);
    const secretsBefore = readFileSync(data.secrets, 'utf8');
    writeFileSync(data.config, JSON.stringify({ ...JSON.parse(readFileSync(data.config, 'utf8')), apiPort: 4000 }));

    const again = fakeHost({ installed: [...first.installed] });
    await setup({ layout, dataDir, services: true }, again);
    const cmds = again.events;
    expect(cmds.filter((e) => e.startsWith('initdb'))).toEqual([]);
    expect(cmds.filter((e) => e === 'pg_ctl register')).toEqual([]);
    expect(cmds.filter((e) => /^victorflow\w+ install$/.test(e))).toEqual([]);
    expect(again.calls.filter((c) => c.cmd === 'icacls.exe' && !c.args.includes('*S-1-5-32-545:R'))).toEqual([]);
    expect(readFileSync(data.secrets, 'utf8')).toBe(secretsBefore);
    // services are stopped first (they hold the ports), and the new port reaches the firewall and the health check
    expect(again.calls[0]!.cmd).toBe('powershell.exe');
    expect(again.calls[0]!.args.at(-1)).toMatch(/Stop-Service/);
    expect(again.calls.some((c) => c.cmd === 'netsh.exe' && c.args.includes('localport=4000'))).toBe(true);
    expect(cmds).toContain('waitApi 4000');
  });

  it('moves the leftover of a failed earlier initdb aside (never deletes it) and starts the cluster fresh', async () => {
    const { layout, dataDir } = tempInstall();
    const data = dataLayout(dataDir);
    mkdirSync(data.postgres, { recursive: true });
    writeFileSync(path.join(data.postgres, 'half-written'), 'x');
    await setup({ layout, dataDir, services: true }, fakeHost());
    expect(existsSync(path.join(data.postgres, 'PG_VERSION'))).toBe(true);
    const aside = readdirSync(dataDir).find((d) => d.startsWith('postgres.incomplete-'))!;
    expect(existsSync(path.join(dataDir, aside, 'half-written'))).toBe(true);
  });
});

describe('vf-server setup — refusals', () => {
  it('names whoever holds a port, and says which setting to change', async () => {
    const { layout, dataDir } = tempInstall();
    const err = await setup({ layout, dataDir, services: true }, fakeHost({ busyPorts: { 3000: 'Some Dev Server (PID 42)' } })).catch((e: unknown) => e as VfError);
    expect(err).toBeInstanceOf(VfError);
    expect((err as VfError).code).toBe('PORT_IN_USE');
    expect((err as VfError).message).toMatch(/Port 3000 \(apiPort\) is already used by Some Dev Server \(PID 42\)/);
    expect((err as VfError).message).toContain(dataLayout(dataDir).config);
  });

  it('needs an administrator, an installed copy, and a sane data folder', async () => {
    const { layout, dataDir } = tempInstall();
    expect(await codeOf(setup({ layout, dataDir, services: true }, fakeHost({ admin: false })))).toBe('NOT_ADMIN');
    expect(await codeOf(setup({ layout: { ...layout, kind: 'repo' }, dataDir, services: true }, fakeHost()))).toBe('LAYOUT');
    expect(await codeOf(setup({ layout, dataDir: '\\\\nas\\share\\vf', services: true }, fakeHost()))).toBe('DATA_DIR');
    expect(await codeOf(setup({ layout, dataDir: path.join(layout.root, 'data'), services: true }, fakeHost()))).toBe('DATA_DIR');
  });

  it('reports a failed initdb with its output', async () => {
    const { layout, dataDir } = tempInstall();
    const host = fakeHost({ fail: (c) => (/initdb/i.test(c.cmd) ? { status: 1, stdout: '', stderr: 'initdb: could not create directory' } : undefined) });
    const err = (await setup({ layout, dataDir, services: true }, host).catch((e: unknown) => e)) as VfError;
    expect(err.code).toBe('PG_INIT');
    expect(err.detail).toContain('could not create directory');
    // the temporary grant is removed even though initdb failed
    expect(host.calls.at(-1)).toMatchObject({ cmd: 'icacls.exe', args: [dataLayout(dataDir).postgres, '/remove:g', '*S-1-5-21-111-222-333-1001'] });
  });
});

describe('vf-server setup --no-services (repository / testing)', () => {
  it('prepares the data folder and the cluster only: no permissions, services, firewall or Windows tools at all', async () => {
    const { layout, dataDir } = tempInstall();
    const host = fakeHost({ admin: false });
    await setup({ layout: { ...layout, kind: 'repo' }, dataDir, services: false }, host);
    expect(host.calls.map((c) => path.basename(c.cmd).replace(/\.exe$/i, ''))).toEqual(['initdb']);
    const data = dataLayout(dataDir);
    for (const file of [data.config, data.secrets, data.addresses, data.firstLogin, path.join(data.postgres, 'victorflow.conf')]) expect(existsSync(file), file).toBe(true);
    expect(host.events).not.toContain('prepareDatabase');
  });
});

describe('vf-server remove', () => {
  it('stops everything (best effort), unregisters each service and the firewall rules — and leaves the data folder alone', async () => {
    const { layout, dataDir } = tempInstall();
    const first = fakeHost();
    await setup({ layout, dataDir, services: true }, first);
    const before = readdirSync(dataDir).sort();

    const host = fakeHost({ installed: [...first.installed] });
    for (const id of first.installed) writeFileSync(path.join(layout.servicesDir, `${id}.exe`), ''); // the wrappers exist
    remove(layout, dataDir, host);
    expect(host.calls[0]!.args.at(-1)).toMatch(/^\$ErrorActionPreference='Continue'.*Stop-Service/);
    expect(host.installed.size).toBe(0);
    expect(host.events).toContain('pg_ctl unregister');
    expect(host.calls.at(-1)!.args.at(-1)).toMatch(/Remove-NetFirewallRule/);
    expect(readdirSync(dataDir).sort()).toEqual(before);
    expect(host.logs.at(-1)).toContain(dataDir);
  });
});
