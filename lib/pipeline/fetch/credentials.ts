/**
 * Load Gong and Outreach credentials from the orgs table.
 * Mirrors the pattern in packages/core/src/query/soql/auth.ts (loadSalesforceCredentials).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GongCredentials, OutreachCredentials } from '../types/api-responses';

const DEFAULT_GONG_BASE_URL = 'https://us-23508.api.gong.io';
const DEFAULT_OUTREACH_BASE_URL = 'https://api.outreach.io';

/**
 * Load Gong API credentials from the orgs table.
 * Returns null when credentials are not configured.
 */
export async function loadGongCredentials(
  supabase: SupabaseClient,
  orgId: string,
): Promise<GongCredentials | null> {
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
