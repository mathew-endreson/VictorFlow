// vf-server — sets up and runs VictorFlow Server on the shop's server computer (see README.md → "Install the server").
import { fileURLToPath } from 'node:url';
import { parseArgs, USAGE } from './args';
import { remove, start, status, stop } from './control';
import { VfError } from './errors';
import { realHost } from './host';
import { dataDirProblem, dataLayout, detectLayout, resolveDataDir } from './layout';
import { runApi, runPostgres, runWeb } from './run';
import { setup } from './setup';

/** Returns the exit code, or null for `run` (the process keeps serving until it is stopped). */
async function main(argv: string[]): Promise<number | null> {
  const args = parseArgs(argv);
  if (args.command === 'help') {
    console.log(USAGE);
    return 0;
  }
  const layout = detectLayout(fileURLToPath(import.meta.url));
  const dataDir = resolveDataDir({ flag: args.dataDir, env: process.env.VF_DATA_DIR, layout });

  switch (args.command) {
    case 'setup': {
      const problem = dataDirProblem(dataDir, layout.root);
      if (problem) throw new VfError('DATA_DIR', `Data folder "${dataDir}": ${problem}`);
      const host = realHost(dataLayout(dataDir).setupLog);
      try {
        await setup({ layout, dataDir, services: args.services }, host);
      } catch (e) {
        // The installer points at setup.log when setup fails: the reason must be in it, not only on a hidden console.
        host.log(`FAILED: ${e instanceof Error ? e.message : String(e)}${e instanceof VfError && e.detail ? `\n${e.detail}` : ''}`);
        throw e;
      }
      return 0;
    }
    case 'remove':
      remove(layout, dataDir, realHost());
      return 0;
    case 'start':
      start(layout, realHost());
      return 0;
    case 'stop':
      stop(layout, realHost());
      return 0;
    case 'status': {
      const report = await status(layout, dataDir, realHost());
      console.log(report.text);
      return report.healthy ? 0 : 3;
    }
    case 'run':
      if (args.component === 'api') await runApi(layout, dataDir);
      else if (args.component === 'tracker' || args.component === 'display') runWeb(layout, args.component, dataDir);
      else if (args.component === 'postgres') runPostgres(layout, dataDir);
      else throw new VfError('USAGE', 'run what? api, tracker, display or postgres');
      return null;
    default:
      throw new VfError('USAGE', `unknown command "${args.command}"\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== null) process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof VfError) {
      console.error(`vf-server: ${err.message}`);
      if (err.detail) console.error(err.detail);
      process.exitCode = err.exitCode;
    } else {
      console.error('vf-server: unexpected error', err);
      process.exitCode = 1;
    }
  },
);
