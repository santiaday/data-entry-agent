/**
 * Salesforce REST API helpers for sObject PATCH writes.
 * Reuses the auth infrastructure from @/lib/sf (getSalesforceToken, SalesforceTokenCache).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSalesforceToken,
  type SalesforceTokenCache,
} from '@/lib/sf';
import { WriteError } from '../errors';
import { withRetry, isRetryableHttpError } from './retry';

/** Salesforce REST API version — kept in sync with @/lib/sf. */
export const SF_API_VERSION = 'v62.0';

export type PatchSObjectParams = {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly tokenCache: SalesforceTokenCache;
  readonly objectType: string;
  readonly recordId: string;
  readonly fields: Record<string, unknown>;
};

export type PatchResult = {
  readonly ok: boolean;
  readonly error?: string;
  readonly statusCode?: number;
  /**
   * Fields rejected during auto-retry. Key is the field API name, value is
   * the SF error message that caused its removal. These are fields that were
   * attempted but stripped from the final successful PATCH because SF refused
   * them (e.g. bad picklist value, invalid format, missing required reference).
   */
  readonly rejectedFields?: Record<string, string>;
};

/**
 * One entry in a SF error response. A single PATCH can return multiple of these
 * (one per offending field/violation) and we need to keep them separate so each
 * rejected field gets only its own error message attributed, not a concatenation
 * of every field's error in the response.
 */
type SfErrorEntry = {
  message: string;
  errorCode?: string;
  fields: string[];
};

/**
 * Max number of field-rejection retries per PATCH.
 * SF's REST API rejects the whole PATCH if any single field is bad, so we
 * peel off rejected fields and retry. This cap protects against pathological
 * cases where every field gets rejected one by one.
 */
const MAX_FIELD_REJECTION_RETRIES = 10;

/**
 * PATCH a Salesforce sObject record.
 * Uses /services/data/{version}/sobjects/{objectType}/{recordId}.
 *
 * Salesforce behavior:
 *   - 204 No Content on success
 *   - 401 → token expired; we refresh once and retry
 *   - 400 → one or more field values were rejected (entire PATCH fails).
 *     We parse the error's "fields" array, remove those fields from the
 *     payload, and retry with what's left. Repeat up to MAX_FIELD_REJECTION_RETRIES
 *     times so a single bad picklist value doesn't wipe out a 55-field write.
 *   - 5xx → transient, use withRetry with exponential backoff
 *
 * Returns rejectedFields so the caller can mark those extractions as
 * write-failed and surface the SF error to the user.
 */
export async function patchSObject(params: PatchSObjectParams): Promise<PatchResult> {
  const { supabase, orgId, tokenCache, objectType, recordId, fields } = params;

  if (Object.keys(fields).length === 0) {
    return { ok: true };
  }

  return withRetry(
    () => patchSObjectWithFieldRetry({ supabase, orgId, tokenCache, objectType, recordId, fields }),
    {
      maxAttempts: 2,
      baseDelayMs: 2000,
      retryOn: isRetryableHttpError,
    },
  );
}

async function patchSObjectWithFieldRetry(params: PatchSObjectParams): Promise<PatchResult> {
  const { supabase, orgId, tokenCache, objectType, recordId, fields } = params;

  // Make a mutable copy — we'll peel off rejected fields on each retry.
  let currentFields: Record<string, unknown> = { ...fields };
  const rejectedFields: Record<string, string> = {};

  for (let attempt = 0; attempt <= MAX_FIELD_REJECTION_RETRIES; attempt++) {
    if (Object.keys(currentFields).length === 0) {
      // Every attempted field was rejected. Return a failure with the rejection details.
      return {
        ok: false,
        error: 'All fields rejected by Salesforce',
        rejectedFields,
      };
    }

    let token = await getSalesforceToken({ supabase, orgId, cache: tokenCache });
    const url = `${token.instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${objectType}/${recordId}`;

    let response = await doSfPatch(url, token.accessToken, currentFields);

    // 401 = expired token. Refresh and retry exactly once per attempt.
    if (response.status === 401) {
      tokenCache.invalidate(orgId);
      token = await getSalesforceToken({ supabase, orgId, cache: tokenCache, forceRefresh: true });
      response = await doSfPatch(url, token.accessToken, currentFields);
    }

    if (response.status === 204) {
      return {
        ok: true,
        rejectedFields: Object.keys(rejectedFields).length > 0 ? rejectedFields : undefined,
      };
    }

    // 5xx — throw so withRetry catches and retries with backoff
    if (response.status >= 500) {
      const body = await response.text();
      throw new WriteError(
        `SF PATCH ${objectType}/${recordId} failed (${response.status}): ${body}`,
        objectType,
        recordId,
        response.status,
      );
    }

    // 4xx — parse structured errors. Each entry names its own fields so we can
    // attribute the right message to the right rejected field.
    const entries = await parseSfPatchErrorStructured(response);

    // If no entry names any field, we can't retry granularly.
    const totalFieldCount = entries.reduce((s, e) => s + e.fields.length, 0);
    if (totalFieldCount === 0) {
      const combined = entries.map((e) => e.message).filter(Boolean).join('; ');
      return {
        ok: false,
        error: combined || 'Unknown Salesforce error',
        statusCode: response.status,
        rejectedFields: Object.keys(rejectedFields).length > 0 ? rejectedFields : undefined,
      };
    }

    // Attribute each error message only to the fields it names.
    for (const entry of entries) {
      for (const f of entry.fields) {
        if (f in currentFields) {
          rejectedFields[f] = entry.message;
          delete currentFields[f];
        }
      }
    }
  }

  return {
    ok: false,
    error: `Exceeded max field-rejection retries (${MAX_FIELD_REJECTION_RETRIES})`,
    rejectedFields,
  };
}

async function doSfPatch(
  url: string,
  accessToken: string,
  fields: Record<string, unknown>,
): Promise<Response> {
  return fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(fields),
  });
}

/**
 * Parse a SF error response into one or more structured entries.
 *
 * SF returns either an array of errors (most common for sObject operations)
 * or a single error object. Each entry names zero or more offending fields.
 * We preserve the entries separately so per-field attribution is accurate —
 * a rejection on "AI_Buyer_Persona__c" should never leak its message onto
 * "AI_Buying_Scenario__c" just because both were in the same response.
 */
async function parseSfPatchErrorStructured(response: Response): Promise<SfErrorEntry[]> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object')
        .map((e) => ({
          message: typeof e.message === 'string' ? e.message : 'Unknown Salesforce error',
          errorCode: typeof e.errorCode === 'string' ? e.errorCode : undefined,
          fields: Array.isArray(e.fields)
            ? e.fields.filter((f: unknown): f is string => typeof f === 'string')
            : [],
        }));
    }

    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      return [{
        message: typeof obj.message === 'string' ? obj.message : 'Unknown Salesforce error',
        errorCode: typeof obj.errorCode === 'string' ? obj.errorCode : undefined,
        fields: Array.isArray(obj.fields)
          ? obj.fields.filter((f: unknown): f is string => typeof f === 'string')
          : [],
      }];
    }
  } catch {
    // fall through
  }

  return [{ message: text || response.statusText, fields: [] }];
}
