/**
 * Export Data Entry Agent data from a source Postgres database to a JSON file,
 * to be POSTed to a deployment via /api/admin/import. Use this when the target
 * database isn't reachable directly (e.g. a private VPC DB) but the app is.
 *
 * Usage:
 *   SOURCE_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
 *   pnpm export-data            # writes data-export.json
 *
 * Excludes the orgs row (credentials) by design — keep those in env vars.
 */
import { config } from 'dotenv';
import * as path from 'node:path';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

config({ path: path.join(process.cwd(), '.env.local') });
config({ path: path.join(process.cwd(), '.env') });

const TABLES = [
  'de_prompts',
  'de_field_configs',
  'de_batches',
  'de_runs',
  'de_extractions',
  'data_entry_queue',
];

const OUT = path.join(process.cwd(), 'data-export.json');

function sslFor(connectionString: string) {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
  return local || /sslmode=disable/.test(connectionString) ? false : { rejectUnauthorized: false };
}

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

async function main() {
  const source = process.env.SOURCE_DATABASE_URL;
  if (!source) throw new Error('SOURCE_DATABASE_URL is not set');

  const client = new pg.Client({ connectionString: source, ssl: sslFor(source) });
  await client.connect();
  const tables: Record<string, unknown[]> = {};
  try {
    for (const table of TABLES) {
      try {
        const rows = (await client.query(`SELECT * FROM ${ident(table)}`)).rows;
        tables[table] = rows;
        console.log(`  ${table}: ${rows.length} rows`);
      } catch (err) {
        console.log(`  ${table}: not present in source — skipped (${err instanceof Error ? err.message : err})`);
      }
    }
  } finally {
    await client.end();
  }

  writeFileSync(OUT, JSON.stringify({ tables }, null, 0));
  const total = Object.values(tables).reduce((n, r) => n + r.length, 0);
  console.log(`\nWrote ${OUT} (${total} rows total).`);
}

main().catch((err) => {
  console.error('[export]', err instanceof Error ? err.message : err);
  process.exit(1);
});
