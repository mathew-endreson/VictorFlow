import type os from 'node:os';
import { describe, expect, it } from 'vitest';
import { addressesFor, addressesIni, addressesText, firstLoginText, PUBLIC_NETWORK_WARNING } from './addresses';
import { parseArgs } from './args';
import { isHealthyApi } from './health';
import { lanAddresses } from './net';
import { defaultConfig } from './store';

type Iface = ReturnType<typeof os.networkInterfaces>[string];
const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null }) as NonNullable<Iface>[number];

describe('lanAddresses', () => {
  it('lists the real network card first; leaves out loopback, self-assigned and IPv6', () => {
    const ifaces = {
      'vEthernet (WSL)': [v4('172.20.0.1')],
      Loopback: [v4('127.0.0.1', true)],
      Ethernet: [v4('192.168.1.10'), { ...v4('fe80::1'), family: 'IPv6' } as NonNullable<Iface>[number]],
      'Wi-Fi': [v4('169.254.10.2')],
    };
    expect(lanAddresses(ifaces)).toEqual(['192.168.1.10', '172.20.0.1']);
  });
});

describe('addresses', () => {
  const config = defaultConfig('SHOP-SERVER');
  const a = addressesFor(config, { ips: ['192.168.1.10'], hostname: 'SHOP-SERVER', publicNetwork: true, firstLoginFile: 'C:\\ProgramData\\VictorFlow\\first-login.txt' });

  it('gives desktop PCs host:port (what the sign-in screen accepts), by IP and by computer name', () => {
    expect(a).toMatchObject({ api: '192.168.1.10:3000', apiByName: 'SHOP-SERVER:3000', tracker: 'http://192.168.1.10:3001', display: 'http://192.168.1.10:3002' });
    expect(addressesFor(config, { ips: [], hostname: 'PC', publicNetwork: false, firstLoginFile: '' }).api).toBe('PC:3000');
  });

  it('is readable by the installer (ini) and by people (status), with the Public-network warning', () => {
    expect(addressesIni(a)).toContain('\r\napi=192.168.1.10:3000\r\n');
    expect(addressesIni(a)).toContain('publicNetwork=1');
    expect(addressesText(a)).toContain(PUBLIC_NETWORK_WARNING);
    expect(addressesText({ ...a, publicNetwork: false })).not.toContain('Public');
  });

  it('first-login.txt carries the seeded admin account in three languages', () => {
    const text = firstLoginText('s3cret-pass');
    expect(text).toContain('admin@victorflow.local');
    expect(text).toContain('s3cret-pass');
    expect(text).toMatch(/Mot de passe/);
    expect(text).toMatch(/كلمة المرور/);
  });
});

describe('isHealthyApi', () => {
  it('only a named VictorFlow API that is ok (or degraded: running without Redis)', () => {
    expect(isHealthyApi({ service: 'victorflow-api', status: 'ok', db: 'up' })).toBe(true);
    expect(isHealthyApi({ service: 'victorflow-api', status: 'degraded', db: 'up' })).toBe(true);
    expect(isHealthyApi({ service: 'victorflow-api', status: 'down', db: 'down' })).toBe(false);
    expect(isHealthyApi({ status: 'ok' })).toBe(false);
    expect(isHealthyApi(null)).toBe(false);
  });
});

describe('parseArgs', () => {
  it('reads the command, the component, --data-dir and --no-services', () => {
    expect(parseArgs(['setup', '--data-dir', 'D:\\vf', '--no-services'])).toEqual({ command: 'setup', component: undefined, dataDir: 'D:\\vf', services: false });
    expect(parseArgs(['run', 'api'])).toMatchObject({ command: 'run', component: 'api', services: true });
    expect(parseArgs([])).toMatchObject({ command: 'help' });
    expect(parseArgs(['--help'])).toMatchObject({ command: 'help' });
    expect(() => parseArgs(['setup', '--data-dir'])).toThrow(/needs a folder/);
    expect(() => parseArgs(['setup', '--force'])).toThrow(/unknown option/);
  });
});
