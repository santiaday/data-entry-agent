/**
 * Manual migration runner: `pnpm migrate`.
 * Loads env from the repo root, then applies pending migrations.
 */
import { config } from 'dotenv';
import * as path from 'node:path';
import { runMigrations } from '@/lib/db/migrate';

const cwd = process.cwd();
config({ path: path.join(cwd, '.env.local') });
config({ path: path.join(cwd, '.env') });

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrate]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
