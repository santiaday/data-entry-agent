/**
 * GET /api/health — non-sensitive diagnostics.
 *
 * Reports which environment variables the running process can see. Secrets are
 * booleans only (never values); non-secret config identifiers (the data-entry
 * Lambda API base URL) echo their actual value so a deploy can be verified at a
 * glance. Useful for confirming a deploy picked up its env vars. Public (listed
 * in middleware PUBLIC_PATHS).
 *
 * The control panel no longer talks to the revops SQL endpoint directly — every
 * former /api/data-entry/* route is served by the revops-agents Lambda, reached
 * via NEXT_PUBLIC_DATA_ENTRY_API_BASE with the NEXT_PUBLIC_DATA_ENTRY_API_TOKEN
 * bearer. Those are the vars that now gate the whole panel.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function present(key: string): boolean {
  const v = process.env[key];
  return !!(v && v.trim());
}

export async function GET() {
  const sfPrivateKey = present('SF_PRIVATE_KEY_BASE64') || present('SF_PRIVATE_KEY');
  const env = {
    DATABASE_URL: present('DATABASE_URL'),
    OPENAI_API_KEY: present('OPENAI_API_KEY'),
    APP_ACCESS_PASSWORD: present('APP_ACCESS_PASSWORD'),
    NEXT_PUBLIC_APP_URL: present('NEXT_PUBLIC_APP_URL'),
    SF_INSTANCE_URL: present('SF_INSTANCE_URL'),
    SF_CLIENT_ID: present('SF_CLIENT_ID'),
    SF_USERNAME: present('SF_USERNAME'),
    SF_PRIVATE_KEY: sfPrivateKey,
    GONG_ACCESS_KEY: present('GONG_ACCESS_KEY'),
    GONG_ACCESS_KEY_SECRET: present('GONG_ACCESS_KEY_SECRET'),
    OUTREACH_CLIENT_ID: present('OUTREACH_CLIENT_ID'),
    OUTREACH_CLIENT_SECRET: present('OUTREACH_CLIENT_SECRET'),
    OUTREACH_REFRESH_TOKEN: present('OUTREACH_REFRESH_TOKEN'),
  };

  // The data-entry control panel now calls the revops-agents Lambda API. The
  // base URL is a non-secret config identifier → safe to echo its VALUE so a
  // deploy can be verified at a glance; the bearer is a secret → presence
  // boolean only. A failing data-entry page means one of these is unset here.
  // Runtime config (read here at request time — NOT build-time NEXT_PUBLIC_*).
  // Base falls back to a hardcoded default in lib/api/client.ts, so only the
  // token must be set in the running environment for the panel to work. Legacy
  // NEXT_PUBLIC_* names are still honored.
  const apiBase =
    process.env.DATA_ENTRY_API_BASE ?? process.env.NEXT_PUBLIC_DATA_ENTRY_API_BASE ?? null;
  const tokenPresent =
    present('DATA_ENTRY_API_TOKEN') || present('NEXT_PUBLIC_DATA_ENTRY_API_TOKEN');
  const dataEntryApi = {
    DATA_ENTRY_API_BASE: apiBase, // null → client uses its hardcoded default
    DATA_ENTRY_API_TOKEN_present: tokenPresent,
  };

  return NextResponse.json({
    ok: true,
    // The token is the only required runtime var (base has a hardcoded default).
    dataEntryApiConfigured: tokenPresent,
    dataEntryApi,
    // True when all four SF env vars are set — i.e. the agent will authenticate
    // from env without touching the orgs row.
    salesforceCredentialsFromEnv:
      env.SF_INSTANCE_URL && env.SF_CLIENT_ID && env.SF_USERNAME && env.SF_PRIVATE_KEY,
    env,
  });
}
