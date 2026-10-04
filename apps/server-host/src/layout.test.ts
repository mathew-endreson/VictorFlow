import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataDirProblem, detectLayout, resolveDataDir, type ProgramLayout } from './layout';

const fakeFs = (files: string[]) => {
  const set = new Set(files.map((f) => path.resolve(f)));
  return (p: string) => set.has(path.resolve(p));
};

describe('detectLayout', () => {
  it('an installed copy: everything is a sibling of vf-server.mjs', () => {
    const root = 'C:\\Program Files\\VictorFlow Server';
    const layout = detectLayout(path.join(root, 'vf-server.mjs'), fakeFs([path.join(root, 'server', 'dist', 'main.js')]));
    expect(layout.kind).toBe('installed');
    expect(layout.nodeExe).toBe(path.join(root, 'node', process.platform === 'win32' ? 'node.exe' : 'node'));
    expect(layout.pgBin).toBe(path.join(root, 'pg', 'bin'));
    expect(layout.dbModuleDir).toBe(path.join(root, 'server', 'node_modules', '@victorflow', 'db'));
    expect(layout.migrationsDir).toBe(path.join(root, 'migrations'));
    expect(layout.tracker).toEqual({ dir: path.join(root, 'tracker'), entry: path.join(root, 'tracker', 'server.js') });
    expect(layout.display).toEqual({ dir: path.join(root, 'display'), entry: path.join(root, 'display', 'server.js') });
    expect(layout.servicesDir).toBe(path.join(root, 'services'));
  });

  it('the repository: the API, migrations and apps from the checkout; the web apps run with next start', () => {
    const repo = 'C:\\src\\victorflow';
    const layout = detectLayout(path.join(repo, 'apps', 'server-host', 'dist', 'vf-server.mjs'), fakeFs([path.join(repo, 'pnpm-workspace.yaml')]));
    expect(layout.kind).toBe('repo');
    expect(layout.serverDir).toBe(path.join(repo, 'apps', 'server'));
    expect(layout.migrationsDir).toBe(path.join(repo, 'packages', 'db', 'migrations'));
    expect(layout.tracker).toEqual({ dir: path.join(repo, 'apps', 'tracker'), entry: null });
    expect(layout.display).toEqual({ dir: path.join(repo, 'apps', 'display'), entry: null });
  });

  it('refuses to guess outside both', () => {
    expect(() => detectLayout('C:\\somewhere\\vf-server.mjs', () => false)).toThrow(/neither/);
  });
});

describe('resolveDataDir', () => {
  const layout = { root: 'C:\\Program Files\\VictorFlow Server' } as ProgramLayout;
  const recorded = (dataDir: string) => (p: string) => (p === path.join(layout.root, 'install.json') ? JSON.stringify({ dataDir }) : null);

  it('--data-dir, then VF_DATA_DIR, then what setup recorded, then %ProgramData%\\VictorFlow', () => {
    expect(resolveDataDir({ flag: 'D:\\vf', env: 'E:\\vf', layout, read: recorded('F:\\vf') })).toBe(path.resolve('D:\\vf'));
    expect(resolveDataDir({ env: 'E:\\vf', layout, read: recorded('F:\\vf') })).toBe(path.resolve('E:\\vf'));
    expect(resolveDataDir({ layout, read: recorded('F:\\vf') })).toBe('F:\\vf');
    expect(resolveDataDir({ layout, read: () => null, programData: 'C:\\ProgramData' })).toBe(path.join('C:\\ProgramData', 'VictorFlow'));
    expect(resolveDataDir({ layout, read: () => '{broken', programData: 'C:\\ProgramData' })).toBe(path.join('C:\\ProgramData', 'VictorFlow'));
  });
});

describe('dataDirProblem', () => {
  const programRoot = 'C:\\Program Files\\VictorFlow Server';
  it('accepts a plain local folder', () => {
    expect(dataDirProblem('C:\\ProgramData\\VictorFlow', programRoot)).toBeNull();
    expect(dataDirProblem('D:\\VictorFlow Data', programRoot)).toBeNull();
  });
  it('refuses network shares, relative paths, accents and anything inside the program folder', () => {
    expect(dataDirProblem('\\\\nas\\share\\vf', programRoot)).toMatch(/network/);
    expect(dataDirProblem('data\\vf', programRoot)).toMatch(/full local path/);
    expect(dataDirProblem('C:\\Données\\VictorFlow', programRoot)).toMatch(/plain letters/);
    expect(dataDirProblem('C:\\بيانات', programRoot)).toMatch(/plain letters/);
    expect(dataDirProblem('C:\\Program Files\\VictorFlow Server\\data', programRoot)).toMatch(/program folder/);
    expect(dataDirProblem('C:\\Program Files\\VictorFlow Server', programRoot)).toMatch(/program folder/);
  });
});
