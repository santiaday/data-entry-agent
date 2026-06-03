import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSalesforceToken,
  SalesforceAuthError,
  SalesforceTokenCache,
} from './auth';

/**
 * Salesforce SOQL executor. Takes a pre-validated query and an auth
 * token, returns structured results. Handles the common error cases
 * (401 re-auth retry, 400 SOQL error, 403 permission, 429 rate limit).
 */

export const SF_API_VERSION = 'v62.0';
const LARGE_RESULT_THRESHOLD = 10_000;

export type SoqlRecord = Record<string, unknown>;

export type QueryResult = {
  totalSize: number;
  records: SoqlRecord[];
  done: boolean;
  nextRecordsUrl?: string;
  notes: string[];
};

export class SalesforceQueryError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: string,
  ) {
    super(message);
    this.name = 'SalesforceQueryError';
  }
}

async function doRequest(
  url: string,
  accessToken: string,
): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
}

async function parseSfError(response: Response): Promise<{
  message: string;
  errorCode?: string;
}> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    // SF returns an array of { message, errorCode } for query errors
    if (Array.isArray(parsed) && parsed[0]) {
      return {
        message: parsed[0].message ?? 'Unknown Salesforce error',
        errorCode: parsed[0].errorCode,
      };
    }
    if (parsed.error_description) {
      return { message: parsed.error_description, errorCode: parsed.error };
    }
  } catch {
    // fall through
  }
  return { message: text || response.statusText };
}

/**
 * Execute a validated SOQL query against Salesforce. Will re-auth and
 * retry once on 401 (caller must pass a token cache for this to work).
 */
export async function executeSoql(params: {
  query: string;
  orgId: string;
  supabase: SupabaseClient;
  tokenCache: SalesforceTokenCache;
}): Promise<QueryResult> {
  const { query, orgId, supabase, tokenCache } = params;

  let token = await getSalesforceToken({ supabase, orgId, cache: tokenCache });

  const endpoint = (instanceUrl: string) =>
    `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(query)}`;

  let response = await doRequest(endpoint(token.instanceUrl), token.accessToken);

  // Single retry on 401 (expired token)
  if (response.status === 401) {
    tokenCache.invalidate(orgId);
    token = await getSalesforceToken({
      supabase,
      orgId,
      cache: tokenCache,
      forceRefresh: true,
    });
    response = await doRequest(endpoint(token.instanceUrl), token.accessToken);
  }

  if (!response.ok) {
    const { message, errorCode } = await parseSfError(response);
    switch (response.status) {
      case 400:
        throw new SalesforceQueryError(
          `SOQL error: ${message}`,
          400,
          errorCode,
        );
      case 401:
        throw new SalesforceAuthError(
          `Authentication failed after refresh: ${message}`,
          401,
          errorCode,
        );
      case 403:
        throw new SalesforceQueryError(
          `Insufficient permissions: ${message}`,
          403,
          errorCode,
        );
      case 429:
        throw new SalesforceQueryError(
          `Rate limited by Salesforce: ${message}`,
          429,
          errorCode,
        );
      default:
        throw new SalesforceQueryError(
          `Salesforce query failed (${response.status}): ${message}`,
          response.status,
          errorCode,
        );
    }
  }

  const data = (await response.json()) as {
    totalSize: number;
    done: boolean;
    records: SoqlRecord[];
    nextRecordsUrl?: string;
  };

  console.log('[soql-executor] response:', {
    totalSize: data.totalSize,
    done: data.done,
    recordsLength: data.records?.length ?? 0,
  });

  const notes: string[] = [];
  if (data.totalSize === 0) {
    notes.push('No records found for this query.');
  }
  if (data.totalSize > LARGE_RESULT_THRESHOLD) {
    notes.push(
      `Large result set (${data.totalSize.toLocaleString()} rows) — only the first batch was returned.`,
    );
  }

  return {
    totalSize: data.totalSize,
    records: data.records ?? [],
    done: data.done,
    nextRecordsUrl: data.nextRecordsUrl,
    notes,
  };
}
