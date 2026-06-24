/**
 * API client for the data-entry control panel.
 *
 * The control panel no longer owns a backend. Every former
 * `/api/data-entry/<sub>` Next.js route now lives in the revops-agents Lambda
 * behind the shared HTTP API Gateway. This helper is the single place that
 * knows the Lambda base URL and attaches the shared bearer header, so call
 * sites simply swap `fetch('/api/data-entry/<sub>')` → `apiFetch('/<sub>')`
 * and keep their existing request/response handling unchanged.
 *
 * Works in both client components (browser) and server components: it reads
 * `NEXT_PUBLIC_*` env vars (inlined at build time for the browser, available at
 * runtime on the server) and calls the absolute Lambda URL with the same JSON
 * in / JSON out contract the old routes had. The Lambda returns the SAME
 * response shapes and the SAME { error, code } error envelope, so no consuming
 * component needs to change.
 */

/** Lambda base, e.g. https://1r7hjb5jv6.execute-api.us-east-1.amazonaws.com/prod/data-entry */
const API_BASE = process.env.NEXT_PUBLIC_DATA_ENTRY_API_BASE ?? '';
/** Shared bearer the Lambda checks via the X-Internal-Secret header. */
const API_TOKEN = process.env.NEXT_PUBLIC_DATA_ENTRY_API_TOKEN ?? '';

/** Join the configured base with a sub-path, tolerating a trailing/leading slash. */
function buildUrl(path: string): string {
  const base = API_BASE.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * fetch() against the data-entry Lambda. Identical signature/semantics to the
 * browser `fetch` the call sites used against the old Next.js routes — the only
 * differences are the absolute base URL and the always-attached bearer header.
 * Returns the raw Response so existing `res.ok` / `res.json()` handling is
 * untouched.
 *
 * @param path  sub-path under the Lambda base, e.g. '/queue?limit=100'
 * @param init  standard fetch RequestInit (method, body, headers, …)
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (API_TOKEN) headers.set('X-Internal-Secret', API_TOKEN);
  return fetch(buildUrl(path), { ...init, headers });
}
