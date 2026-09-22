/* eslint-disable no-console */
import { createDb } from './client';
import { loadEnv } from './env';
import { migrateToLatest, resetDatabase } from './migrate';
import { seed } from './seed';
import { seedPassword } from './seed-guard';

async function main() {
  const command = process.argv[2];
  loadEnv();

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
  const db = createDb(url, { max: 2 });

  try {
    switch (command) {
      case 'migrate': {
        const { applied } = await migrateToLatest(db);
        console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
        break;
      }
      case 'seed': {
        const summary = await seed(db, {
          demoPassword: seedPassword(),
          log: (m) => console.log(`  · ${m}`),
        });
        console.log(`Seeded: ${JSON.stringify(summary)}`);
        console.log('Sign-in: admin@victorflow.local (password from SEED_DEMO_PASSWORD; the development default is "Admin123!")');
        break;
      }
      case 'reset': {
        await resetDatabase(db);
        const { applied } = await migrateToLatest(db);
        console.log(`Reset. Applied: ${applied.join(', ')}`);
        await seed(db, { demoPassword: process.env.SEED_DEMO_PASSWORD ?? 'Admin123!' });
        console.log('Re-seeded.');
        break;
      }
      default:
        console.error('Usage: cli.ts <migrate|seed|reset>');
        process.exitCode = 2;
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
