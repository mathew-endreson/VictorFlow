// Everything setup/remove/status do to the machine goes through a Host, so the whole sequence can be unit-tested with
// a fake one that records commands instead of running them.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareDatabase } from './db';
import { fetchApiHealth, isHealthyApi, waitUntil, webAnswers } from './health';
import type { ProgramLayout } from './layout';
import { lanAddresses, portFree } from './net';
import type { Secrets, ServerConfig } from './store';

export interface CmdResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface Host {
  run(cmd: string, args: string[]): CmdResult;
  log(line: string): void;
  isAdmin(): boolean;
  hostname(): string;
  lanAddresses(): string[];
  publicNetwork(): boolean;
  portFree(port: number): Promise<boolean>;
  /** Who listens on a port, for a useful "port in use" message ("PostgreSQL Server 18 (PID 7588)"). */
  portOwner(port: number): string | null;
  prepareDatabase(layout: ProgramLayout, config: ServerConfig, secrets: Secrets): Promise<void>;
  waitApi(port: number, timeoutMs: number): Promise<boolean>;
  waitWeb(port: number, timeoutMs: number): Promise<boolean>;
}

function exec(cmd: string, args: string[]): CmdResult {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  return { status: r.status ?? (r.error ? -1 : 0), stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error.message) : '') };
}

const powershell = (command: string) => exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);

export function realHost(logFile?: string): Host {
  if (logFile) mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (line: string) => {
    console.log(line);
    if (logFile) {
      try {
        appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
      } catch {
        /* the console still has it */
      }
    }
  };
  return {
    run: (cmd, args) => {
      const r = exec(cmd, args);
      if (logFile) {
        try {
          appendFileSync(logFile, `${new Date().toISOString()} > ${cmd} ${args.join(' ')} → ${r.status}\n${r.stdout}${r.stderr}`.trimEnd() + '\n');
        } catch {
          /* best effort */
        }
      }
      return r;
    },
    log,
    // `net session` only succeeds for an elevated administrator, in every Windows language.
    isAdmin: () => exec('net', ['session']).status === 0,
    hostname: () => os.hostname(),
    lanAddresses: () => lanAddresses(),
    publicNetwork: () => /\bPublic\b/.test(powershell('Get-NetConnectionProfile | ForEach-Object { $_.NetworkCategory.ToString() }').stdout),
    portFree,
    portOwner: (port) => {
      const netstat = exec('netstat', ['-ano']);
      const m = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'm').exec(netstat.stdout);
      if (!m) return null;
      const pid = m[1];
      const name = powershell(`$s = Get-CimInstance Win32_Service -Filter "ProcessId=${pid}"; if ($s) { $s.DisplayName } else { (Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName }`).stdout.trim();
      return `${name || 'a program'} (PID ${pid})`;
    },
    prepareDatabase: (layout, config, secrets) => prepareDatabase(layout, config, secrets, log),
    waitApi: (port, timeoutMs) => waitUntil(async () => isHealthyApi(await fetchApiHealth(port)), timeoutMs),
    waitWeb: (port, timeoutMs) => waitUntil(() => webAnswers(port), timeoutMs),
  };
}
