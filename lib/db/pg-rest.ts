/**
 * A tiny PostgREST-compatible query builder backed by node-postgres.
 *
 * The app was originally written against the Supabase JS client (`.from(...)
 * .select(...).eq(...)` etc.), which talks to Supabase's PostgREST HTTP layer.
 * This deployment uses a plain PostgreSQL database (DATABASE_URL) with no
 * PostgREST in front of it, so this module reimplements the exact subset of
 * the Supabase query-builder surface the app uses, directly over SQL.
 *
 * Supported: from, select (incl. { count, head }), insert, update, delete,
 * upsert ({ onConflict, ignoreDuplicates }), eq/neq/in/gt/gte/lt/lte/like/
 * ilike/is, order, limit, range, single, maybeSingle. The builder is thenable
 * and resolves to `{ data, error, count }` — it never rejects, so existing
 * `if (error)` call sites keep working.
 *
 * Values are bound as parameters. Column types are introspected once per table
 * (cached) so JS objects/arrays are encoded correctly for `jsonb` vs `text[]`.
 */

import { Pool, type PoolClient } from 'pg';

// ── Connection pool (singleton) ─────────────────────────────────

let pool: Pool | null = null;

function isLocal(connectionString: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
}

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  // Managed Postgres (e.g. RDS) requires TLS but typically presents a cert
  // chain we do not pin — mirror the `sslmode=no-verify` semantics. Local
  // databases run without TLS.
  const disableSsl =
    isLocal(connectionString) || /sslmode=disable/.test(connectionString);
  pool = new Pool({
    connectionString,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
    max: 10,
  });
  return pool;
}

// ── Column-type introspection (per table, cached) ───────────────

type ColumnType = { dataType: string; udtName: string };
const typeCache = new Map<string, Map<string, ColumnType>>();

async function getColumnTypes(
  table: string,
  exec: Queryable,
): Promise<Map<string, ColumnType>> {
  const cached = typeCache.get(table);
  if (cached) return cached;
  const res = await exec.query(
    `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const map = new Map<string, ColumnType>();
  for (const row of res.rows as { column_name: string; data_type: string; udt_name: string }[]) {
    map.set(row.column_name, { dataType: row.data_type, udtName: row.udt_name });
  }
  typeCache.set(table, map);
  return map;
}

/** Coerce a JS value into something node-postgres binds correctly for the column. */
function encodeValue(value: unknown, type: ColumnType | undefined): unknown {
  if (value === undefined || value === null) return null;
  const isJson = type && (type.dataType === 'jsonb' || type.dataType === 'json');
  const isArrayColumn = type && type.dataType === 'ARRAY';

  if (isJson) {
    // jsonb/json column: serialize objects AND arrays to a JSON string. The
    // param is sent untyped and Postgres parses it into jsonb.
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  }
  if (isArrayColumn) {
    // text[]/uuid[] column: pass the JS array through — node-postgres encodes
    // it as a Postgres array literal.
    return Array.isArray(value) ? value : value;
  }
  // Unknown column type but an object value → default to JSON (safest for
  // jsonb-ish columns we failed to introspect). Plain scalars pass through.
  if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}

// ── Identifier safety ───────────────────────────────────────────

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

// ── Types ───────────────────────────────────────────────────────

type Queryable = Pick<PoolClient, 'query'> | Pool;

type Filter = {
  op: 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is';
  column: string;
  value: unknown;
};

type Order = { column: string; ascending: boolean; nullsFirst?: boolean };

export type PostgrestResult<T = unknown> = {
  data: T | null;
  error: { message: string; code?: string; details?: string } | null;
  count: number | null;
};

const OP_SQL: Record<Filter['op'], string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
  is: 'IS',
  in: 'IN',
};

// ── Query builder ───────────────────────────────────────────────

class PgQuery implements PromiseLike<PostgrestResult> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private selectColumns = '*';
  private returning: string | null = null; // for insert/update/upsert/delete
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private payload: Record<string, unknown>[] | null = null;
  private updateValues: Record<string, unknown> | null = null;
  private conflictColumns: string[] = [];
  private ignoreDuplicates = false;
  private wantCount = false;
  private headOnly = false;
  private rowMode: 'many' | 'single' | 'maybeSingle' = 'many';

  constructor(private exec: Queryable, private table: string) {}

  // -- mutating verbs --------------------------------------------
  select(columns = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    if (this.op === 'select') {
      this.selectColumns = columns;
      if (opts?.count) this.wantCount = true;
      if (opts?.head) this.headOnly = true;
    } else {
      // .select() chained after insert/update/upsert/delete → RETURNING
      this.returning = columns || '*';
    }
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.op = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(
    rows: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.op = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflictColumns = opts?.onConflict
      ? opts.onConflict.split(',').map((c) => c.trim())
      : [];
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.op = 'update';
    this.updateValues = values;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  // -- filters ---------------------------------------------------
  private addFilter(op: Filter['op'], column: string, value: unknown): this {
    this.filters.push({ op, column, value });
    return this;
  }
  eq(c: string, v: unknown) { return this.addFilter('eq', c, v); }
  neq(c: string, v: unknown) { return this.addFilter('neq', c, v); }
  gt(c: string, v: unknown) { return this.addFilter('gt', c, v); }
  gte(c: string, v: unknown) { return this.addFilter('gte', c, v); }
  lt(c: string, v: unknown) { return this.addFilter('lt', c, v); }
  lte(c: string, v: unknown) { return this.addFilter('lte', c, v); }
  like(c: string, v: unknown) { return this.addFilter('like', c, v); }
  ilike(c: string, v: unknown) { return this.addFilter('ilike', c, v); }
  is(c: string, v: unknown) { return this.addFilter('is', c, v); }
  in(c: string, v: unknown[]) { return this.addFilter('in', c, v); }

  // -- shaping ---------------------------------------------------
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({
      column,
      ascending: opts?.ascending ?? true,
      nullsFirst: opts?.nullsFirst,
    });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number): this {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }

  // -- terminals -------------------------------------------------
  single(): this {
    this.rowMode = 'single';
    if (!this.returning && this.op !== 'select') this.returning = '*';
    return this;
  }
  maybeSingle(): this {
    this.rowMode = 'maybeSingle';
    if (!this.returning && this.op !== 'select') this.returning = '*';
    return this;
  }

  then<TResult1 = PostgrestResult, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  // -- SQL building + execution ----------------------------------
  private whereClause(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    const parts = this.filters.map((f) => {
      const col = ident(f.column);
      if (f.op === 'in') {
        const arr = Array.isArray(f.value) ? f.value : [f.value];
        if (arr.length === 0) return 'false';
        const placeholders = arr.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `${col} IN (${placeholders.join(', ')})`;
      }
      if (f.op === 'is') {
        // .is(col, null) / .is(col, true/false)
        if (f.value === null) return `${col} IS NULL`;
        return `${col} IS ${f.value === true ? 'TRUE' : 'FALSE'}`;
      }
      params.push(f.value);
      return `${col} ${OP_SQL[f.op]} $${params.length}`;
    });
    return ` WHERE ${parts.join(' AND ')}`;
  }

  private orderLimitClause(): string {
    let sql = '';
    if (this.orders.length > 0) {
      const parts = this.orders.map((o) => {
        const dir = o.ascending ? 'ASC' : 'DESC';
        const nulls =
          o.nullsFirst === undefined ? '' : o.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST';
        return `${ident(o.column)} ${dir}${nulls}`;
      });
      sql += ` ORDER BY ${parts.join(', ')}`;
    }
    if (this.limitN !== null) sql += ` LIMIT ${Number(this.limitN)}`;
    if (this.offsetN !== null) sql += ` OFFSET ${Number(this.offsetN)}`;
    return sql;
  }

  private async execute(): Promise<PostgrestResult> {
    try {
      switch (this.op) {
        case 'select':
          return await this.runSelect();
        case 'insert':
        case 'upsert':
          return await this.runInsert();
        case 'update':
          return await this.runUpdate();
        case 'delete':
          return await this.runDelete();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message }, count: null };
    }
  }

  private shapeRows(rows: unknown[], count: number | null): PostgrestResult {
    if (this.rowMode === 'single') {
      if (rows.length === 1) return { data: rows[0], error: null, count };
      return {
        data: null,
        error: {
          code: 'PGRST116',
          message:
            rows.length === 0
              ? 'JSON object requested, multiple (or no) rows returned'
              : 'Results contain multiple rows',
        },
        count,
      };
    }
    if (this.rowMode === 'maybeSingle') {
      if (rows.length <= 1) return { data: rows[0] ?? null, error: null, count };
      return {
        data: null,
        error: { code: 'PGRST116', message: 'Results contain multiple rows' },
        count,
      };
    }
    return { data: rows, error: null, count };
  }

  private async runSelect(): Promise<PostgrestResult> {
    const params: unknown[] = [];
    const where = this.whereClause(params);

    if (this.headOnly) {
      const res = await this.exec.query(
        `SELECT count(*)::int AS count FROM ${ident(this.table)}${where}`,
        params,
      );
      return { data: null, error: null, count: res.rows[0]?.count ?? 0 };
    }

    const cols = this.selectColumns === '*' ? '*' : this.selectColumnList();
    const sql = `SELECT ${cols} FROM ${ident(this.table)}${where}${this.orderLimitClause()}`;
    const res = await this.exec.query(sql, params);

    let count: number | null = null;
    if (this.wantCount) {
      const cParams: unknown[] = [];
      const cWhere = this.whereClause(cParams);
      const cRes = await this.exec.query(
        `SELECT count(*)::int AS count FROM ${ident(this.table)}${cWhere}`,
        cParams,
      );
      count = cRes.rows[0]?.count ?? 0;
    }
    return this.shapeRows(res.rows, count);
  }

  /**
   * Turn a "a, b, c" select list into quoted identifiers. PostgREST embedded
   * resources (e.g. `de_batches!inner(...)`) are not supported by this adapter,
   * so any non-plain-column token is dropped rather than throwing — the base
   * row is still returned. Callers needing the related row should fetch it
   * separately. Falls back to `*` if nothing plain remains.
   */
  private selectColumnList(): string {
    // An embedded resource (parentheses present, e.g. `de_batches!inner(...)`)
    // can't be projected here — its inner column names aren't columns of the
    // base table. Fall back to selecting all base columns; the related row is
    // fetched separately by the caller.
    if (this.selectColumns.includes('(')) return '*';
    const cols = this.selectColumns
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .filter((c) => c === '*' || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c));
    return cols.length ? cols.map((c) => (c === '*' ? '*' : ident(c))).join(', ') : '*';
  }

  private async runInsert(): Promise<PostgrestResult> {
    const rows = this.payload ?? [];
    if (rows.length === 0) return { data: this.returning ? [] : null, error: null, count: null };

    const types = await getColumnTypes(this.table, this.exec);
    const columns = Array.from(
      rows.reduce<Set<string>>((set, r) => {
        Object.keys(r).forEach((k) => set.add(k));
        return set;
      }, new Set()),
    );

    const params: unknown[] = [];
    const valueTuples = rows.map((row) => {
      const placeholders = columns.map((col) => {
        params.push(encodeValue(row[col], types.get(col)));
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    let sql = `INSERT INTO ${ident(this.table)} (${columns.map(ident).join(', ')}) VALUES ${valueTuples.join(', ')}`;

    if (this.op === 'upsert') {
      if (this.conflictColumns.length > 0) {
        const target = this.conflictColumns.map(ident).join(', ');
        if (this.ignoreDuplicates) {
          sql += ` ON CONFLICT (${target}) DO NOTHING`;
        } else {
          const updates = columns
            .filter((c) => !this.conflictColumns.includes(c))
            .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
          sql += updates.length
            ? ` ON CONFLICT (${target}) DO UPDATE SET ${updates.join(', ')}`
            : ` ON CONFLICT (${target}) DO NOTHING`;
        }
      } else {
        sql += ' ON CONFLICT DO NOTHING';
      }
    }

    if (this.returning) sql += ` RETURNING ${this.returning === '*' ? '*' : this.returningList()}`;

    const res = await this.exec.query(sql, params);
    if (!this.returning) return { data: null, error: null, count: res.rowCount };
    return this.shapeRows(res.rows, res.rowCount);
  }

  private async runUpdate(): Promise<PostgrestResult> {
    const values = this.updateValues ?? {};
    const types = await getColumnTypes(this.table, this.exec);
    const params: unknown[] = [];
    const sets = Object.keys(values).map((col) => {
      params.push(encodeValue(values[col], types.get(col)));
      return `${ident(col)} = $${params.length}`;
    });
    if (sets.length === 0) return { data: this.returning ? [] : null, error: null, count: 0 };

    const where = this.whereClause(params);
    let sql = `UPDATE ${ident(this.table)} SET ${sets.join(', ')}${where}`;
    if (this.returning) sql += ` RETURNING ${this.returning === '*' ? '*' : this.returningList()}`;

    const res = await this.exec.query(sql, params);
    if (!this.returning) return { data: null, error: null, count: res.rowCount };
    return this.shapeRows(res.rows, res.rowCount);
  }

  private async runDelete(): Promise<PostgrestResult> {
    const params: unknown[] = [];
    const where = this.whereClause(params);
    let sql = `DELETE FROM ${ident(this.table)}${where}`;
    if (this.returning) sql += ` RETURNING ${this.returning === '*' ? '*' : this.returningList()}`;
    const res = await this.exec.query(sql, params);
    if (!this.returning) return { data: null, error: null, count: res.rowCount };
    return this.shapeRows(res.rows, res.rowCount);
  }

  private returningList(): string {
    return (this.returning ?? '*')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => (c === '*' ? '*' : ident(c)))
      .join(', ');
  }
}

// ── Client surface ──────────────────────────────────────────────

export class PgRestClient {
  constructor(private exec: Queryable = getPool()) {}
  from(table: string): PgQuery {
    return new PgQuery(this.exec, table);
  }
}

/** Construct a client. Cast to the Supabase client type at the call boundary. */
export function createPgRestClient(): PgRestClient {
  return new PgRestClient(getPool());
}
