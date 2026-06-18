/**
 * Remote SQL executor for the revops-agents `/db/{database}/sql` endpoint.
 *
 * The DeployBay UI cannot reach RDS directly (it's VPN-walled) and DeployBay's
 * managed Postgres is not where the agent data lives. Instead the UI talks to
 * revops-db through the webhooks service's SQL endpoint, authenticating as the
 * least-privilege `data_entry_agent` Postgres role via a per-identity bearer.
 *
 * This object is shaped like node-postgres' `{ query(text, params) }` so it can
 * be dropped straight into the existing PgRestClient query-builder
 * (`lib/db/pg-rest.ts`) with no builder changes — only the executor swaps.
 *
 * Endpoint contract (services/webhooks/src/handlers/query.ts):
 *   POST {REVOPS_SQL_ENDPOINT}/db/{REVOPS_DB_NAME}/sql
 *   headers: X-Identity, X-Internal-Secret, content-type: application/json
 *   body:    { sql, params?, max_rows?, timeout_ms? }   // single statement only
 *   resp:    { ok, rows, row_count, truncated, duration_ms, query_id, identity }
 */

export interface RemoteQueryResult {
  rows: unknown[];
  rowCount: number | null;
}

export interface RemoteSqlConfig {
  endpoint: string;   // e.g. https://1r7hjb5jv6.execute-api.us-east-1.amazonaws.com/prod
  database: string;   // e.g. revops_agent_platform
  identity: string;   // e.g. data_entry_agent
  bearer: string;     // per-identity secret
  maxRows?: number;
  timeoutMs?: number;
}

export class RemoteSqlError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
    this.name = "RemoteSqlError";
  }
}

export function resolveRemoteSqlConfig(): RemoteSqlConfig {
  const endpoint = process.env.REVOPS_SQL_ENDPOINT;
  const database = process.env.REVOPS_DB_NAME ?? "revops_agent_platform";
  const identity = process.env.REVOPS_DB_IDENTITY ?? "data_entry_agent";
  const bearer = process.env.REVOPS_DB_BEARER;
  if (!endpoint) throw new RemoteSqlError("REVOPS_SQL_ENDPOINT is not set");
  if (!bearer) throw new RemoteSqlError("REVOPS_DB_BEARER is not set");
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    database,
    identity,
    bearer,
    maxRows: process.env.REVOPS_SQL_MAX_ROWS ? Number(process.env.REVOPS_SQL_MAX_ROWS) : 5000,
    timeoutMs: process.env.REVOPS_SQL_TIMEOUT_MS ? Number(process.env.REVOPS_SQL_TIMEOUT_MS) : 25000,
  };
}

/**
 * Raw-SQL escape hatch for read-only aggregations the query-builder can't
 * express (GROUP BY, joins). Single statement, parameterized. Returns rows.
 */
export async function revopsQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await createRemoteExec().query(sql, params);
  return res.rows as T[];
}

/** A node-postgres-shaped executor that runs each query against the remote endpoint. */
export function createRemoteExec(cfg: RemoteSqlConfig = resolveRemoteSqlConfig()) {
  const url = `${cfg.endpoint}/db/${encodeURIComponent(cfg.database)}/sql`;
  return {
    async query(text: string, params: unknown[] = []): Promise<RemoteQueryResult> {
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Identity": cfg.identity,
            "X-Internal-Secret": cfg.bearer,
          },
          body: JSON.stringify({
            sql: text,
            params,
            max_rows: cfg.maxRows,
            timeout_ms: cfg.timeoutMs,
          }),
        });
      } catch (e) {
        throw new RemoteSqlError(`SQL endpoint unreachable: ${(e as Error).message}`);
      }
      const bodyText = await resp.text();
      let body: any;
      try {
        body = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        throw new RemoteSqlError(`SQL endpoint returned non-JSON (${resp.status}): ${bodyText.slice(0, 200)}`, resp.status);
      }
      if (!resp.ok || body?.ok === false) {
        const msg = body?.error ?? body?.message ?? `SQL endpoint error ${resp.status}`;
        throw new RemoteSqlError(String(msg), resp.status, body?.code);
      }
      return {
        rows: Array.isArray(body.rows) ? body.rows : [],
        rowCount: typeof body.row_count === "number" ? body.row_count : (Array.isArray(body.rows) ? body.rows.length : null),
      };
    },
  };
}
