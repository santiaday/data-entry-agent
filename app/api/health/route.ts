/**
 * GET /api/health — non-sensitive diagnostics.
 *
 * Reports which environment variables the running process can see (as booleans
 * only — never values) and whether Salesforce credentials are resolvable from
 * env. Useful for confirming a deploy picked up its env vars and is running the
 * env-first credential code. Public (listed in middleware PUBLIC_PATHS).
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

  return NextResponse.json({
    ok: true,
    // True when all four SF env vars are set — i.e. the agent will authenticate
    // from env without touching the orgs row.
    salesforceCredentialsFromEnv:
      env.SF_INSTANCE_URL && env.SF_CLIENT_ID && env.SF_USERNAME && env.SF_PRIVATE_KEY,
    env,
  });
}
