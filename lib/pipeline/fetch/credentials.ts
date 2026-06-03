/**
 * Load Gong and Outreach credentials. Environment variables take precedence;
 * the `orgs` row is used as a fallback. Mirrors loadSalesforceCredentials.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GongCredentials, OutreachCredentials } from '../types/api-responses';

const DEFAULT_GONG_BASE_URL = 'https://us-23508.api.gong.io';
const DEFAULT_OUTREACH_BASE_URL = 'https://api.outreach.io';

function readEnv(key: string): string | null {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : null;
}

/**
 * Load Gong API credentials. Environment variables (GONG_ACCESS_KEY,
 * GONG_ACCESS_KEY_SECRET, optional GONG_BASE_URL) take precedence over the
 * `orgs` row. Returns null when configured in neither place.
 */
export async function loadGongCredentials(
  supabase: SupabaseClient,
  orgId: string,
): Promise<GongCredentials | null> {
  const envKey = readEnv('GONG_ACCESS_KEY');
  const envSecret = readEnv('GONG_ACCESS_KEY_SECRET');
  if (envKey && envSecret) {
    return {
      accessKey: envKey,
      accessKeySecret: envSecret,
      baseUrl: readEnv('GONG_BASE_URL') ?? DEFAULT_GONG_BASE_URL,
    };
  }

  const { data, error } = await supabase
    .from('orgs')
    .select('gong_access_key, gong_access_key_secret')
    .eq('id', orgId)
    .single();

  if (error) {
    throw new Error(`Failed to load Gong credentials: ${error.message}`);
  }

  if (!data || !data.gong_access_key || !data.gong_access_key_secret) {
    return null;
  }

  return {
    accessKey: data.gong_access_key,
    accessKeySecret: data.gong_access_key_secret,
    baseUrl: DEFAULT_GONG_BASE_URL,
  };
}

/**
 * Load Outreach API credentials from the orgs table.
 * Returns null when credentials are not configured.
 */
export async function loadOutreachCredentials(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OutreachCredentials | null> {
  const envClientId = readEnv('OUTREACH_CLIENT_ID');
  const envClientSecret = readEnv('OUTREACH_CLIENT_SECRET');
  const envRefresh = readEnv('OUTREACH_REFRESH_TOKEN');
  if (envClientId && envClientSecret && envRefresh) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      refreshToken: envRefresh,
      baseUrl: readEnv('OUTREACH_BASE_URL') ?? DEFAULT_OUTREACH_BASE_URL,
    };
  }

  const { data, error } = await supabase
    .from('orgs')
    .select('outreach_client_id, outreach_client_secret, outreach_refresh_token')
    .eq('id', orgId)
    .single();

  if (error) {
    throw new Error(`Failed to load Outreach credentials: ${error.message}`);
  }

  if (
    !data ||
    !data.outreach_client_id ||
    !data.outreach_client_secret ||
    !data.outreach_refresh_token
  ) {
    return null;
  }

  return {
    clientId: data.outreach_client_id,
    clientSecret: data.outreach_client_secret,
    refreshToken: data.outreach_refresh_token,
    baseUrl: DEFAULT_OUTREACH_BASE_URL,
  };
}

/**
 * Build the Basic auth header for Gong API requests.
 */
export function buildGongAuthHeader(creds: GongCredentials): string {
  const encoded = Buffer.from(`${creds.accessKey}:${creds.accessKeySecret}`).toString('base64');
  return `Basic ${encoded}`;
}
