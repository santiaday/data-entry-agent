/**
 * Outreach OAuth helper for local dev.
 *
 * Flow:
 *   1. Reads outreach_client_id + outreach_client_secret from local orgs row.
 *   2. Opens your browser to Outreach's authorize URL (with mailings.read).
 *   3. You sign in + click Allow; Outreach redirects to httpbin.org/get,
 *      which displays the callback URL as JSON. Copy the `code` value.
 *   4. Paste the code into the terminal.
 *   5. Script exchanges the code for tokens and UPDATEs orgs.outreach_refresh_token.
 *
 * The redirect URI is hard-coded to https://httpbin.org/get because that's
 * what your Outreach OAuth app has registered. If you ever change the app
 * to allow a localhost redirect, swap REDIRECT_URI for it and add a tiny
 * `node:http` listener instead of the paste step.
 *
 * Outreach-side prereq (one-time):
 *   The OAuth app must have `mailings.read` in its allowed scopes.
 *   If it doesn't, this flow will succeed but the resulting token still
 *   lacks the scope and you'll get the 403 again.
 *
 * Run:
 *   pnpm --filter @/lib/pipeline oauth:outreach
 */

import { exec } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { supabase, ORG_ID } from '@/lib/pipeline/client';

const REDIRECT_URI = 'https://httpbin.org/get';
const AUTH_URL = 'https://api.outreach.io/oauth/authorize';
const TOKEN_URL = 'https://api.outreach.io/oauth/token';

// Keep scopes minimal — Outreach revokes the entire token if any single
// scope is misconfigured. Add more here as future fetchers need them.
const SCOPES = ['mailings.read'];

async function loadCreds(): Promise<{ clientId: string; clientSecret: string }> {
  const { data, error } = await supabase
    .from('orgs')
    .select('outreach_client_id, outreach_client_secret')
    .eq('id', ORG_ID)
    .single();

  if (error || !data) {
    throw new Error(`Could not read orgs row: ${error?.message ?? 'no row'}`);
  }
  if (!data.outreach_client_id || !data.outreach_client_secret) {
    throw new Error(
      'Outreach client_id/secret are not set in the orgs row. ' +
        'Run supabase/seed-credentials.sql first.',
    );
  }
  return {
    clientId: data.outreach_client_id as string,
    clientSecret: data.outreach_client_secret as string,
  };
}

function buildAuthorizeUrl(clientId: string, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

async function promptForCode(expectedState: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log('');
  console.log('After clicking Allow, httpbin.org will show JSON like:');
  console.log('  {');
  console.log('    "args": {');
  console.log('      "code": "abc123…",   ← copy THIS value');
  console.log(`      "state": "${expectedState.slice(0, 8)}…"`);
  console.log('    },');
  console.log('    ...');
  console.log('  }');
  console.log('');
  console.log('You can paste either the bare code value or the full URL —');
  console.log('the script will extract the code either way.');
  console.log('');

  const raw = (await rl.question('Paste code (or full callback URL): ')).trim();
  rl.close();

  if (!raw) throw new Error('No input provided.');

  // Accept either the bare code or a full URL with ?code=…&state=…
  let code = raw;
  let state: string | null = null;
  if (raw.startsWith('http')) {
    const url = new URL(raw);
    code = url.searchParams.get('code') ?? '';
    state = url.searchParams.get('state');
  }

  if (!code) throw new Error('Could not extract code from input.');
  if (state && state !== expectedState) {
    throw new Error(`State mismatch — expected ${expectedState}, got ${state}. Possible CSRF; aborting.`);
  }

  return code;
}

async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scope?: string }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

async function persistRefreshToken(refreshToken: string): Promise<void> {
  const { error } = await supabase
    .from('orgs')
    .update({ outreach_refresh_token: refreshToken })
    .eq('id', ORG_ID);

  if (error) {
    throw new Error(`Failed to update orgs.outreach_refresh_token: ${error.message}`);
  }
}

async function main(): Promise<void> {
  console.log('[outreach-oauth] Loading client credentials from local DB…');
  const { clientId, clientSecret } = await loadCreds();

  const state = randomBytes(16).toString('hex');
  const authorizeUrl = buildAuthorizeUrl(clientId, state);

  console.log(`[outreach-oauth] Scopes requested: ${SCOPES.join(', ')}`);
  console.log('[outreach-oauth] Opening browser to the Outreach authorize page…');
  console.log('');
  console.log('If the browser doesn\'t open, paste this URL manually:');
  console.log(`\n  ${authorizeUrl}\n`);

  exec(`open "${authorizeUrl}"`, () => {
    /* fallback is the printed URL above */
  });

  const code = await promptForCode(state);
  console.log('[outreach-oauth] Code captured. Exchanging for tokens…');

  const tokens = await exchangeCode(code, clientId, clientSecret);
  if (tokens.scope) {
    console.log(`[outreach-oauth] Granted scopes: ${tokens.scope}`);
    if (!tokens.scope.split(/\s+/).includes('mailings.read')) {
      console.warn(
        '[outreach-oauth] WARNING: mailings.read was NOT granted. ' +
          'The OAuth app likely does not have that scope enabled. ' +
          'Saving the token anyway, but the 403 will persist.',
      );
    }
  }

  await persistRefreshToken(tokens.refreshToken);

  console.log(`\n✓ Done. New refresh_token saved to orgs.outreach_refresh_token.`);
  console.log(`  Access token expires in ${tokens.expiresIn}s (runtime refreshes as needed).\n`);
  console.log(`Verify by re-running a batch:`);
  console.log(`  pnpm data-entry -- --record-id 006QU00000EcbOHYAZ --object-type Opportunity --dry-run`);
  console.log(`\nYou should see "[fetch] outreachMailings: ok" instead of the 403.`);
}

main().catch((err) => {
  console.error('[outreach-oauth] ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
