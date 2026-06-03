/**
 * Idempotent migration runner. Applies supabase/migrations/*.sql in filename
 * order against DATABASE_URL, tracking applied files in a _migrations table.
 *
 * Invoked automatically on server boot (instrumentation.ts) and available as a
 * CLI (`pnpm migrate`).
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getPool } from '@/lib/db/pg-rest';

export async function runMigrations(): Promise<void> {
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query('SELECT filename FROM public._migrations')).rows.map(
        (r: { filename: string }) => r.filename,
      ),
    );

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), 'utf8');
      process.stdout.write(`[migrate] applying ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO public._migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('ok');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw err;
      }
    }
    console.log(`[migrate] done — ${ran} applied, ${files.length - ran} already up to date`);
  } finally {
    client.release();
  }
}
