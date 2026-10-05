import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, loadConfig, loadOrCreateConfig, loadOrCreateSecrets, mergeConfig } from './store';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'vf-store-'));

describe('config.json', () => {
  it('defaults: API 3000, tracker 3001, displays 3002, PostgreSQL 55432, tracking links through the computer name', () => {
    expect(defaultConfig('SHOP-SERVER')).toEqual({ apiPort: 3000, trackerPort: 3001, displayPort: 3002, pgPort: 55432, trackerPublicUrl: 'http://shop-server:3001', extraCorsOrigins: [], licenceServerUrl: '' });
  });

  it('keeps what the shop set, fills in what is missing, and names what is wrong', () => {
    expect(mergeConfig({ apiPort: 8080, trackerPublicUrl: 'https://suivi.shop.dz/' }, 'pc')).toMatchObject({ apiPort: 8080, trackerPort: 3001, trackerPublicUrl: 'https://suivi.shop.dz' });
    expect(() => mergeConfig({ apiPort: 'x' }, 'pc')).toThrow(/apiPort must be a port number/);
    expect(() => mergeConfig({ trackerPort: 3000 }, 'pc')).toThrow(/must all be different/);
    expect(() => mergeConfig({ trackerPublicUrl: 'ftp://x' }, 'pc')).toThrow(/trackerPublicUrl/);
    expect(() => mergeConfig({ extraCorsOrigins: 'http://x' }, 'pc')).toThrow(/extraCorsOrigins/);
    expect(() => mergeConfig({ licenceServerUrl: 'licence.bluxtech.dz' }, 'pc')).toThrow(/licenceServerUrl/);
    expect(mergeConfig({ licenceServerUrl: ' https://licence.bluxtech.dz/activate ' }, 'pc').licenceServerUrl).toBe('https://licence.bluxtech.dz/activate');
  });

  it('tracking links follow a changed tracker port, unless an address was set on purpose', () => {
    expect(mergeConfig({ trackerPort: 8001 }, 'SHOP').trackerPublicUrl).toBe('http://shop:8001');
    expect(mergeConfig({ trackerPort: 8001, trackerPublicUrl: 'https://suivi.shop.dz' }, 'SHOP').trackerPublicUrl).toBe('https://suivi.shop.dz');
  });

  it('is written on first use and read back as it was edited (a Notepad BOM included)', () => {
    const file = path.join(tmp(), 'config.json');
    expect(loadOrCreateConfig(file, 'PC').created).toBe(true);
    writeFileSync(file, `\uFEFF${JSON.stringify({ apiPort: 4000 })}`);
    const { config, created } = loadOrCreateConfig(file, 'PC');
    expect(created).toBe(false);
    expect(config.apiPort).toBe(4000);
    expect(JSON.parse(readFileSync(file, 'utf8')).displayPort).toBe(3002); // the missing settings were written back
  });

  it('keeps an automatic tracker address automatic on disk, so a later port change still moves it', () => {
    const file = path.join(tmp(), 'config.json');
    expect(loadOrCreateConfig(file, 'SHOP').config.trackerPublicUrl).toBe('http://shop:3001');
    expect(JSON.parse(readFileSync(file, 'utf8')).trackerPublicUrl).toBe('');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), trackerPort: 8001 }));
    expect(loadOrCreateConfig(file, 'SHOP').config.trackerPublicUrl).toBe('http://shop:8001');
    expect(loadConfig(file, 'SHOP').trackerPublicUrl).toBe('http://shop:8001');
  });
});

describe('secrets.json', () => {
  it('is generated once, with strong values, and never regenerated', () => {
    const file = path.join(tmp(), 'secrets.json');
    const first = loadOrCreateSecrets(file);
    expect(first.created).toBe(true);
    expect(first.secrets.jwtAccessSecret.length).toBeGreaterThanOrEqual(32);
    expect(first.secrets.trackingHmacSecret.length).toBeGreaterThanOrEqual(32);
    const second = loadOrCreateSecrets(file);
    expect(second).toEqual({ secrets: first.secrets, created: false });
  });

  it('only adds keys an older install lacks; existing values win', () => {
    const file = path.join(tmp(), 'secrets.json');
    writeFileSync(file, JSON.stringify({ dbPassword: 'old-db', jwtAccessSecret: 'j'.repeat(40) }));
    const { secrets } = loadOrCreateSecrets(file);
    expect(secrets.dbPassword).toBe('old-db');
    expect(secrets.trackingHmacSecret.length).toBeGreaterThanOrEqual(32);
    expect(JSON.parse(readFileSync(file, 'utf8')).trackingHmacSecret).toBe(secrets.trackingHmacSecret);
  });

  it('no admin password any more, and a trial install\'s old one is left untouched (its demo admin can still sign in)', () => {
    expect(Object.keys(loadOrCreateSecrets(path.join(tmp(), 'secrets.json')).secrets).sort()).toEqual(['dbPassword', 'jwtAccessSecret', 'trackingHmacSecret']);
    const file = path.join(tmp(), 'secrets.json');
    const old = { dbPassword: 'd', jwtAccessSecret: 'j'.repeat(40), trackingHmacSecret: 't'.repeat(40), adminPassword: 'kept-as-is' };
    writeFileSync(file, JSON.stringify(old));
    loadOrCreateSecrets(file);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(old);
  });
});
