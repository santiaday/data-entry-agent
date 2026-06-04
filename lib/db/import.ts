/**
 * Bulk data import used by POST /api/admin/import.
 *
 * Because the database is only reachable from inside the deployment's network,
 * data is shipped to the running app as JSON and written here. Upserts by `id`,
 * copies only columns that exist in the destination, and encodes jsonb/text[]
 * correctly (same rules as the pg-rest adapter and the sync script).
 */

import { getPool } from '@/lib/db/pg-rest';

// FK-safe parent→child order for inserts.
const IMPORT_ORDER = [
  'de_prompts',
  'de_field_configs',
  'de_batches',
  'de_runs',
  'de_extractions',
  'data_entry_queue',
] as const;

// Reverse order for truncation (children first). orgs is intentionally excluded.
const TRUNCATE_ORDER = [
  'data_entry_queue',
  'de_extractions',
  'de_runs',
  'de_batches',
  'de_field_configs',
  'de_prompts',
] as const;

const CHUNK = 500;

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

function encode(value: unknown, dataType: string | undefined): unknown {
  if (value === undefined || value === null) return null;
  if ((dataType === 'jsonb' || dataType === 'json') && typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && dataType !== 'ARRAY') {
    return JSON.stringify(value);
  }
  return value;
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

async function destColumns(client: Queryable, table: string): Promise<Map<string, string>> {
  const res = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  const m = new Map<string, string>();
  for (const r of res.rows as { column_name: string; data_type: string }[]) {
    m.set(r.column_name, r.data_type);
  }
  return m;
}

async function upsertRows(client: Queryable, table: string, rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const dstCols = await destColumns(client, table);
  if (dstCols.size === 0) return 0; // table doesn't exist in destination
  const cols = Object.keys(rows[0]).filter((c) => dstCols.has(c));
  if (cols.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const ph = cols.map((c) => {
        params.push(encode(row[c], dstCols.get(c)));
        return `$${params.length}`;
      });
      return `(${ph.join(', ')})`;
    });
    const updates = cols.filter((c) => c !== 'id').map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
    const onConflict = updates.length
      ? `ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}`
      : 'ON CONFLICT (id) DO NOTHING';
    const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES ${tuples.join(', ')} ${onConflict}`;
    await client.query(sql, params);
    written += chunk.length;
  }
  return written;
}

export type ImportPayload = {
  tables: Record<string, Record<string, unknown>[]>;
  replace?: boolean;
};

export type ImportResult = {
  replaced: boolean;
  counts: Record<string, number>;
};

export async function importData(payload: ImportPayload): Promise<ImportResult> {
  const pool = getPool();
  const client = await pool.connect();
  const counts: Record<string, number> = {};
  try {
    if (payload.replace) {
      const list = TRUNCATE_ORDER.map(ident).join(', ');
      await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    }
    for (const table of IMPORT_ORDER) {
      const rows = payload.tables[table];
      if (!rows || rows.length === 0) continue;
      counts[table] = await upsertRows(client, table, rows);
    }
    return { replaced: !!payload.replace, counts };
  } finally {
    client.release();
  }
}
