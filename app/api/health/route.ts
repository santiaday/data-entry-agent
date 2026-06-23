/**
 * GET /api/health — non-sensitive diagnostics.
 *
 * Reports which environment variables the running process can see. Secrets are
 * booleans only (never values); non-secret config identifiers (the revops SQL
 * endpoint URL, db key, identity, agent_ref) echo their actual value so a deploy
 * can be verified at a glance. Useful for confirming a deploy picked up its env
 * vars. Public (listed in middleware PUBLIC_PATHS).
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

  // revops-backed control panel: the vars that actually drive every
  // /api/data-entry/* route. Endpoint/db-key/identity are non-secret config
  // identifiers → safe to echo their VALUES so a deploy can be verified at a
  // glance; the bearer is a secret → presence boolean only. An EMPTY 500 on
  // /api/data-entry/* means REVOPS_SQL_ENDPOINT or REVOPS_DB_BEARER is unset here.
  const revops = {
    REVOPS_SQL_ENDPOINT: process.env.REVOPS_SQL_ENDPOINT ?? null,
    REVOPS_DB_NAME: process.env.REVOPS_DB_NAME ?? '(default) agent_platform',
    REVOPS_DB_IDENTITY: process.env.REVOPS_DB_IDENTITY ?? '(default) data_entry_agent',
    REVOPS_DB_BEARER_present: present('REVOPS_DB_BEARER'),
    AGENT_REF: process.env.AGENT_REF ?? '(default) sales/data-entry-agent',
  };

  return NextResponse.json({
    ok: true,
    // The control panel cannot serve any /api/data-entry/* route unless BOTH
    // of these are set in the RUNNING process.
    revopsBackendConfigured: !!(process.env.REVOPS_SQL_ENDPOINT && process.env.REVOPS_DB_BEARER),
    revops,
    // True when all four SF env vars are set — i.e. the agent will authenticate
    // from env without touching the orgs row.
    salesforceCredentialsFromEnv:
      env.SF_INSTANCE_URL && env.SF_CLIENT_ID && env.SF_USERNAME && env.SF_PRIVATE_KEY,
    env,
  });
}
