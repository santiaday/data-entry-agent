/**
 * withRevops — a uniform error boundary for every data-entry route handler.
 *
 * The query-builder (lib/db/pg-rest.ts) never rejects — it catches and returns
 * `{ error }`. BUT the executor it wraps is created by createServiceClient() →
 * createRemoteExec() → resolveRemoteSqlConfig(), which THROWS a RemoteSqlError
 * synchronously when REVOPS_SQL_ENDPOINT / REVOPS_DB_BEARER are missing, and the
 * remote `fetch` can throw when the SQL endpoint is unreachable. Those throws
 * happen OUTSIDE the builder's try/catch, so an unwrapped route returns a bare,
 * empty 500 with no body — the client's `r.json()` then throws and the UI shows
 * a generic failure with no explanation.
 *
 * Wrapping every handler in withRevops converts those throws into a structured
 * JSON error the UI can render: the RemoteSqlError message (and its status/code
 * when present) for known backend conditions, or a generic 'Backend unavailable'
 * 503 for anything unexpected. The raw error is always logged server-side.
 */

import { RemoteSqlError } from '@/lib/revops/sql-client';
import { jsonError } from '@/lib/revops/mappers';

/**
 * A Next.js App Router route handler. The optional second argument carries the
 * dynamic-segment context (`{ params }`) for `[id]`-style routes; static routes
 * simply ignore it.
 */
type RouteHandler<Ctx> = (request: Request, ctx: Ctx) => Promise<Response>;

export function withRevops<Ctx = unknown>(
  handler: RouteHandler<Ctx>,
): RouteHandler<Ctx> {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(request, ctx);
    } catch (e) {
      // Always log the raw error server-side for diagnosis; never leak it whole.
      console.error('[data-entry route] backend error:', e);

      if (e instanceof RemoteSqlError) {
        return jsonError(e.message, e.status ?? 503, 'BACKEND_UNAVAILABLE');
      }

      return jsonError('Backend unavailable', 503, 'BACKEND_UNAVAILABLE');
    }
  };
}

/** Shape of the error the query-builder returns on a failed write/read. */
interface DbWriteError {
  code?: string | null;
  message?: string | null;
}

/**
 * Map a Postgres write failure to a sanitized JSON error response.
 *
 * Raw Postgres messages can leak internal schema detail and use the wrong HTTP
 * status (a 500 for what is really a 409 duplicate or a 400 constraint
 * violation). This logs the full error server-side and returns a user-friendly,
 * code-mapped response:
 *   23505 (unique_violation)      → 409 DUPLICATE
 *   23514 (check_violation)       → 400 INVALID
 *   23502 (not_null_violation)    → 400 INVALID
 *   23503 (foreign_key_violation) → 400 INVALID
 *   everything else               → 500 with `fallbackCode`
 *
 * @param error        the builder's `{ error }` object (code + message)
 * @param duplicateMsg user-facing message for a 23505 (e.g. "A field with that key already exists")
 * @param fallbackMsg  user-facing message for unmapped failures
 * @param fallbackCode machine code for unmapped failures (e.g. 'CREATE_FAILED')
 */
export function mapDbWriteError(
  error: DbWriteError,
  duplicateMsg: string,
  fallbackMsg: string,
  fallbackCode: string,
): Response {
  // Log the raw error (with its real message + code) server-side only.
  console.error('[data-entry route] db write error:', error.code, error.message);

  // Prefer the structured SQLSTATE code; fall back to detecting it in the raw
  // message, since the remote SQL endpoint may surface the code only in text.
  const code = error.code ?? detectSqlState(error.message);

  switch (code) {
    case '23505':
      return jsonError(duplicateMsg, 409, 'DUPLICATE');
    case '23514':
    case '23502':
    case '23503':
      return jsonError('The request violates a database constraint', 400, 'INVALID');
    default:
      return jsonError(fallbackMsg, 500, fallbackCode);
  }
}

/** Recover a Postgres SQLSTATE from a raw error message when no code is set. */
function detectSqlState(message: string | null | undefined): string | undefined {
  if (!message) return undefined;
  const m = message.match(/\b(23505|23514|23502|23503)\b/);
  if (m) return m[1];
  if (/duplicate key value|unique constraint/i.test(message)) return '23505';
  if (/violates check constraint/i.test(message)) return '23514';
  if (/null value in column|not-null constraint/i.test(message)) return '23502';
  if (/violates foreign key constraint/i.test(message)) return '23503';
  return undefined;
}
