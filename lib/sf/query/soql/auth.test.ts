import { afterEach, describe, expect, it } from 'vitest';
import { loadSalesforceCredentials } from './auth';

// A supabase stand-in that fails the test if the DB path is ever taken.
const throwingSupabase = {
  from() {
    throw new Error('DB should not be queried when env credentials are present');
  },
} as never;

const SF_KEYS = ['SF_INSTANCE_URL', 'SF_CLIENT_ID', 'SF_USERNAME', 'SF_PRIVATE_KEY', 'SF_PRIVATE_KEY_BASE64'];

afterEach(() => {
  for (const k of SF_KEYS) delete process.env[k];
});

describe('loadSalesforceCredentials — env-first', () => {
  it('reads credentials from env and skips the DB (raw PEM)', async () => {
    process.env.SF_INSTANCE_URL = 'https://acme.my.salesforce.com';
    process.env.SF_CLIENT_ID = 'CK';
    process.env.SF_USERNAME = 'int@acme.com';
    process.env.SF_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';

    const creds = await loadSalesforceCredentials(throwingSupabase, 'org');
    expect(creds).not.toBeNull();
    expect(creds?.instanceUrl).toBe('https://acme.my.salesforce.com');
    expect(creds?.privateKey).toContain('BEGIN PRIVATE KEY');
  });

  it('un-escapes \\n in a single-line SF_PRIVATE_KEY', async () => {
    process.env.SF_INSTANCE_URL = 'https://acme.my.salesforce.com';
    process.env.SF_CLIENT_ID = 'CK';
    process.env.SF_USERNAME = 'int@acme.com';
    process.env.SF_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nLINE1\\nLINE2\\n-----END PRIVATE KEY-----';

    const creds = await loadSalesforceCredentials(throwingSupabase, 'org');
    expect(creds?.privateKey.split('\n').length).toBe(4);
    expect(creds?.privateKey).not.toContain('\\n');
  });

  it('decodes SF_PRIVATE_KEY_BASE64', async () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nXYZ\n-----END PRIVATE KEY-----';
    process.env.SF_INSTANCE_URL = 'https://acme.my.salesforce.com';
    process.env.SF_CLIENT_ID = 'CK';
    process.env.SF_USERNAME = 'int@acme.com';
    process.env.SF_PRIVATE_KEY_BASE64 = Buffer.from(pem, 'utf8').toString('base64');

    const creds = await loadSalesforceCredentials(throwingSupabase, 'org');
    expect(creds?.privateKey).toBe(pem);
  });

  it('returns null falling through to DB when env is incomplete', async () => {
    process.env.SF_INSTANCE_URL = 'https://acme.my.salesforce.com';
    // missing client id / username / key → must NOT use env, falls to DB.
    // Use a supabase stub that returns no credentials.
    const emptySupabase = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          single() { return Promise.resolve({ data: null, error: null }); },
        };
      },
    } as never;
    const creds = await loadSalesforceCredentials(emptySupabase, 'org');
    expect(creds).toBeNull();
  });
});
