/**
 * One-time data sync: copy all Data Entry Agent data from a SOURCE Postgres
 * database (e.g. your existing Supabase project) into the destination database
 * (DATABASE_URL — your new DeployBay Postgres).
 *
 * Usage:
 *   SOURCE_DATABASE_URL="postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres" \
 *   DATABASE_URL="postgresql://...@dl-prod-postgres.../db_xxx?sslmode=no-verify" \
 *   pnpm sync
 *
 * Where to find SOURCE_DATABASE_URL: Supabase dashboard -> Project Settings ->
 * Database -> Connection string -> "URI" (use the direct connection, port 5432).
 *
 * Behavior:
 *  - orgs:  UPSERT by id (keeps/updates the single org row, incl. SF credentials)
 *  - de_ tables / queue: by default the destination tables are REPLACED
 *    (truncated, then copied) so IDs match the source exactly. Pass --no-replace
 *    to upsert by id
 *    instead (leaves any extra destination rows in place).
 *  - Only columns that exist in BOTH databases are copied, so schema drift between
 *    the source and this build is handled gracefully.
 *
 * Run the destination's migrations first (they run automatically on app boot, or
 * `pnpm migrate`) so the tables exist before syncing.
 */

import { config } from 'dotenv';
import * as path from 'node:path';
import pg from 'pg';

config({ path: path.join(process.cwd(), '.env.local') });
config({ path: path.join(process.cwd(), '.env') });

const REPLACE = !process.argv.includes('--no-replace');
// --skip-orgs: do not copy the orgs row. Recommended when credentials live in
// env vars — avoids writing the Salesforce private key into the destination DB.
const SKIP_ORGS = process.argv.includes('--skip-orgs');

// Copy order respects foreign keys (parents first).
const ALL_TABLES = [
  'orgs',
  'de_prompts',
  'de_field_configs',
  'de_batches',
  'de_runs',
  'de_extractions',
  'data_entry_queue',
] as const;
const TABLES = ALL_TABLES.filter((t) => !(SKIP_ORGS && t === 'orgs'));

// Truncate order is the reverse (children first). orgs is never truncated.
const TRUNCATE_ORDER = [
  'data_entry_queue',
  'de_extractions',
  'de_runs',
  'de_batches',
  'de_field_configs',
  'de_prompts',
] as const;

const CHUNK = 500;

function sslFor(connectionString: string) {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
  const disabled = local || /sslmode=disable/.test(connectionString);
  return disabled ? false : { rejectUnauthorized: false };
}

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

async function destColumns(dst: pg.Client, table: string): Promise<Map<string, string>> {
  const res = await dst.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  const m = new Map<string, string>();
  for (const r of res.rows) m.set(r.column_name, r.data_type);
  return m;
}

function encode(value: unknown, dataType: string | undefined): unknown {
  if (value === undefined || value === null) return null;
  if ((dataType === 'jsonb' || dataType === 'json') && typeof value === 'object') {
    return JSON.stringify(value);
  }
  // ARRAY columns: pass the JS array through (node-postgres encodes it).
  if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && dataType !== 'ARRAY') {
    return JSON.stringify(value);
  }
  return value;
}

async function copyTable(src: pg.Client, dst: pg.Client, table: string): Promise<number> {
  let srcRows: Record<string, unknown>[];
  try {
    srcRows = (await src.query(`SELECT * FROM ${ident(table)}`)).rows as Record<string, unknown>[];
  } catch (err) {
    // e.g. the table doesn't exist in the source schema — skip it.
    console.log(`  ${table}: not present in source — skipped (${err instanceof Error ? err.message : err})`);
    return 0;
  }
  if (srcRows.length === 0) {
    console.log(`  ${table}: 0 rows in source — skipped`);
    return 0;
  }
  const dstCols = await destColumns(dst, table);
  const cols = Object.keys(srcRows[0]).filter((c) => dstCols.has(c));
  if (cols.length === 0) throw new Error(`No matching columns for ${table}`);

  let written = 0;
  for (let i = 0; i < srcRows.length; i += CHUNK) {
    const chunk = srcRows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const ph = cols.map((c) => {
        params.push(encode(row[c], dstCols.get(c)));
        return `$${params.length}`;
      });
      return `(${ph.join(', ')})`;
    });
    const updates = cols
      .filter((c) => c !== 'id')
      .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
    const onConflict = updates.length
      ? `ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}`
      : 'ON CONFLICT (id) DO NOTHING';
    const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES ${tuples.join(', ')} ${onConflict}`;
    await dst.query(sql, params);
    written += chunk.length;
  }
  console.log(`  ${table}: ${written} rows`);
  return written;
}

async function main() {
  const source = process.env.SOURCE_DATABASE_URL;
  const dest = process.env.DATABASE_URL;
  if (!source) throw new Error('SOURCE_DATABASE_URL is not set (your Supabase connection string)');
  if (!dest) throw new Error('DATABASE_URL is not set (your destination database)');
  if (source === dest) throw new Error('SOURCE and DEST are identical — refusing to run');

  const src = new pg.Client({ connectionString: source, ssl: sslFor(source) });
  const dst = new pg.Client({ connectionString: dest, ssl: sslFor(dest) });
  await src.connect();
  await dst.connect();

  try {
    console.log(`Sync mode: ${REPLACE ? 'REPLACE (truncate destination de_*/queue first)' : 'UPSERT by id'}${SKIP_ORGS ? ' · skipping orgs (credentials stay in env)' : ''}`);

    if (REPLACE) {
      const list = TRUNCATE_ORDER.map(ident).join(', ');
      await dst.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
      console.log('  destination de_*/queue tables truncated');
    }

    console.log('Copying:');
    let total = 0;
    for (const table of TABLES) {
      total += await copyTable(src, dst, table);
    }
    console.log(`\nDone — ${total} rows copied.`);
  } finally {
    await src.end();
    await dst.end();
  }
}

main().catch((err) => {
  console.error('[sync]', err instanceof Error ? err.message : err);
  process.exit(1);
});
