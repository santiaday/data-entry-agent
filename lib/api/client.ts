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
 * RUNTIME config — NOT build-time `NEXT_PUBLIC_*`:
 *   The DeployBay image is built by `next build` in a Docker stage that has no
 *   access to deploy-time env, and `NEXT_PUBLIC_*` values are inlined into the
 *   browser bundle AT BUILD TIME. So a runtime-only platform can never make a
 *   `NEXT_PUBLIC_*` value reach the browser. Instead:
 *     • the base URL is a non-secret, stable infra endpoint → hardcoded default
 *       (DEFAULT_API_BASE) so the browser ALWAYS has a working target, and
 *     • on the browser we read `window.__DATA_ENTRY_CONFIG__`, which the root
 *       server layout injects at REQUEST time from the runtime env (see
 *       app/layout.tsx). On the server (server components / route handlers) we
 *       read `process.env` directly at request time.
 *   Set `DATA_ENTRY_API_TOKEN` (and optionally `DATA_ENTRY_API_BASE`) in the
 *   DeployBay *runtime* environment — no rebuild required.
 */

/**
 * The data-entry Lambda base. A public, stable infra endpoint (NOT a secret),
 * so it is safe to hardcode as the default — this guarantees the browser can
 * always reach the Lambda even when no env override is present, which is what
 * prevents calls from silently falling back to a relative (same-origin) URL.
 * Override per environment with DATA_ENTRY_API_BASE.
 */
const DEFAULT_API_BASE =
  'https://1r7hjb5jv6.execute-api.us-east-1.amazonaws.com/prod/data-entry';

interface ApiConfig {
  base: string;
  token: string;
}

/** Shape of the runtime config the server layout injects onto window. */
declare global {
  interface Window {
    __DATA_ENTRY_CONFIG__?: Partial<ApiConfig>;
  }
}

/**
 * Resolve { base, token } at call time.
 *   • Browser: the runtime config injected by the server layout. Falls back to
 *     the hardcoded base so a missing injection still targets the Lambda.
 *   • Server: runtime env (preferring the non-prefixed names; the legacy
 *     NEXT_PUBLIC_* names are still honored if that is what is set).
 */
function resolveConfig(): ApiConfig {
  if (typeof window !== 'undefined') {
    const c = window.__DATA_ENTRY_CONFIG__ ?? {};
    return { base: c.base || DEFAULT_API_BASE, token: c.token || '' };
  }
  return {
    base:
      process.env.DATA_ENTRY_API_BASE ||
      process.env.NEXT_PUBLIC_DATA_ENTRY_API_BASE ||
      DEFAULT_API_BASE,
    token:
      process.env.DATA_ENTRY_API_TOKEN ||
      process.env.NEXT_PUBLIC_DATA_ENTRY_API_TOKEN ||
      '',
  };
}

/** Join the configured base with a sub-path, tolerating a trailing/leading slash. */
function buildUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${b}${suffix}`;
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
  const { base, token } = resolveConfig();
  const headers = new Headers(init.headers);
  if (token) headers.set('X-Internal-Secret', token);
  return fetch(buildUrl(base, path), { ...init, headers });
}
