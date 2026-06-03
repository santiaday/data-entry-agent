/**
 * Optional single shared-password gate.
 *
 * When APP_ACCESS_PASSWORD is set, the middleware requires a valid access
 * cookie for every page/route (except the login flow and the secret-protected
 * webhook/queue endpoints). When it is unset, the app is open (no gate).
 *
 * This is a lightweight gate, not a user system: one shared password, one
 * opaque cookie token (a salted SHA-256 of the password). Uses only Web Crypto
 * so it runs in both the Edge middleware and Node route handlers.
 */

export const ACCESS_COOKIE = 'dea_access';

export function isAccessEnabled(): boolean {
  return !!(process.env.APP_ACCESS_PASSWORD && process.env.APP_ACCESS_PASSWORD.length > 0);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The cookie value a client must present, derived from the configured password. */
export async function tokenForPassword(password: string): Promise<string> {
  return sha256Hex(`dea:access:${password}`);
}

/** Expected cookie token for the currently configured password, or null if disabled. */
export async function expectedToken(): Promise<string | null> {
  const pw = process.env.APP_ACCESS_PASSWORD;
  if (!pw) return null;
  return tokenForPassword(pw);
}
