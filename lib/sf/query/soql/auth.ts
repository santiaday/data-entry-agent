import type { SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

/**
 * Salesforce JWT Bearer Flow authentication.
 *
 * Credentials are stored on the `orgs` row in Supabase; we never touch
 * env vars for SF auth. The access token is cached in-memory per orgId
 * until it expires or a 401 forces a re-auth.
 */

const SF_LOGIN_URL = 'https://login.salesforce.com';
const TOKEN_ENDPOINT = `${SF_LOGIN_URL}/services/oauth2/token`;
/** JWT lifetime (3 minutes per the Salesforce docs — the max allowed). */
const JWT_LIFETIME_SECONDS = 3 * 60;
/** Safety margin: treat token as expired this many ms before real expiry. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

export type SalesforceCredentials = {
  instanceUrl: string;
  clientId: string;
  username: string;
  privateKey: string;
};

export type SalesforceToken = {
  accessToken: string;
  instanceUrl: string;
  /** ms since epoch when this token should be considered expired. */
  expiresAt: number;
};

export class SalesforceAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly sfError?: string,
  ) {
    super(message);
    this.name = 'SalesforceAuthError';
  }
}

function readEnv(key: string): string | null {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : null;
}

/** Load the SF private key from env: SF_PRIVATE_KEY_BASE64 (preferred) or SF_PRIVATE_KEY. */
function loadPrivateKeyFromEnv(): string | null {
  const b64 = readEnv('SF_PRIVATE_KEY_BASE64');
  if (b64) return Buffer.from(b64, 'base64').toString('utf8');
  const raw = process.env.SF_PRIVATE_KEY;
  if (raw && raw.trim()) {
    // Support both real newlines and \n-escaped single-line values.
    return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  }
  return null;
}

/** Read SF credentials from environment variables, or null if not fully set. */
function loadSalesforceCredentialsFromEnv(): SalesforceCredentials | null {
  const instanceUrl = readEnv('SF_INSTANCE_URL');
  const clientId = readEnv('SF_CLIENT_ID');
  const username = readEnv('SF_USERNAME');
  const privateKey = loadPrivateKeyFromEnv();
  if (instanceUrl && clientId && username && privateKey) {
    return { instanceUrl, clientId, username, privateKey };
  }
  return null;
}

/**
 * Load an org's SF credentials. Environment variables take precedence
 * (SF_INSTANCE_URL, SF_CLIENT_ID, SF_USERNAME, SF_PRIVATE_KEY[_BASE64]); if
 * they are not fully set we fall back to the `orgs` row. Returns null when
 * credentials are configured in neither place.
 */
export async function loadSalesforceCredentials(
  supabase: SupabaseClient,
  orgId: string,
): Promise<SalesforceCredentials | null> {
  const fromEnv = loadSalesforceCredentialsFromEnv();
  if (fromEnv) return fromEnv;

  const { data, error } = await supabase
    .from('orgs')
    .select('sf_instance_url, sf_client_id, sf_private_key, sf_username')
    .eq('id', orgId)
    .single();

  if (error) {
    throw new SalesforceAuthError(`Failed to load org credentials: ${error.message}`);
  }
  if (
    !data ||
    !data.sf_instance_url ||
    !data.sf_client_id ||
    !data.sf_private_key ||
    !data.sf_username
  ) {
    return null;
  }

  return {
    instanceUrl: data.sf_instance_url,
    clientId: data.sf_client_id,
    username: data.sf_username,
    privateKey: data.sf_private_key,
  };
}

/**
 * Sign a JWT for the Salesforce Bearer flow. The caller does not set
 * `iat` or `jti` — jsonwebtoken fills them in.
 */
export function signSalesforceJwt(creds: SalesforceCredentials): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: creds.clientId,
    sub: creds.username,
    aud: SF_LOGIN_URL,
    exp: nowSeconds + JWT_LIFETIME_SECONDS,
  };
  return jwt.sign(payload, creds.privateKey, { algorithm: 'RS256' });
}

/**
 * Exchange a signed JWT for an access token.
 * Throws SalesforceAuthError on any non-2xx response.
 */
export async function exchangeJwtForToken(
  assertion: string,
): Promise<SalesforceToken> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    let sfError = text;
    try {
      const parsed = JSON.parse(text);
      sfError = parsed.error_description ?? parsed.error ?? text;
    } catch {
      // ignore
    }
    throw new SalesforceAuthError(
      `Salesforce token exchange failed: ${sfError}`,
      response.status,
      sfError,
    );
  }

  const data = JSON.parse(text) as {
    access_token: string;
    instance_url: string;
    token_type: string;
    id: string;
  };

  return {
    accessToken: data.access_token,
    instanceUrl: data.instance_url,
    expiresAt: Date.now() + JWT_LIFETIME_SECONDS * 1000 - TOKEN_EXPIRY_MARGIN_MS,
  };
}

/**
 * Per-process in-memory token cache keyed by orgId. We never persist
 * tokens to disk or Supabase — they're short-lived and request-scoped.
 */
export class SalesforceTokenCache {
  private cache = new Map<string, SalesforceToken>();

  get(orgId: string): SalesforceToken | null {
    const cached = this.cache.get(orgId);
    if (!cached) return null;
    if (Date.now() >= cached.expiresAt) {
      this.cache.delete(orgId);
      return null;
    }
    return cached;
  }

  set(orgId: string, token: SalesforceToken): void {
    this.cache.set(orgId, token);
  }

  invalidate(orgId: string): void {
    this.cache.delete(orgId);
  }
}

/**
 * Get a valid SF token for an org — from cache if fresh, otherwise
 * perform the full JWT bearer flow.
 */
export async function getSalesforceToken(params: {
  supabase: SupabaseClient;
  orgId: string;
  cache: SalesforceTokenCache;
  forceRefresh?: boolean;
}): Promise<SalesforceToken> {
  const { supabase, orgId, cache, forceRefresh } = params;

  if (!forceRefresh) {
    const cached = cache.get(orgId);
    if (cached) return cached;
  }

  const creds = await loadSalesforceCredentials(supabase, orgId);
  if (!creds) {
    throw new SalesforceAuthError(
      'Salesforce credentials are not configured for this org. ' +
        'Populate sf_instance_url, sf_client_id, sf_username, sf_private_key in the orgs row.',
    );
  }

  const assertion = signSalesforceJwt(creds);
  const token = await exchangeJwtForToken(assertion);
  cache.set(orgId, token);
  return token;
}
