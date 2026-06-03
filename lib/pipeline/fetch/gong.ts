/**
 * Gong API client for Phase 1b.
 *
 * 2 API calls:
 *   1. POST /v2/calls/transcript — full transcript text
 *   2. POST /v2/calls/extensive — topics, trackers, action items, insights
 *
 * Auth: Basic auth (access_key:access_key_secret).
 * Base URL: https://us-23508.api.gong.io (configured per org).
 */

import type { GongCredentials, GongTranscriptResponse, GongExtensiveResponse } from '../types/api-responses';
import type { FetchResult } from '../types/pipeline';
import { buildGongAuthHeader } from './credentials';
import { withRetry, isRetryableHttpError } from '../utils/retry';
import { FetchError } from '../errors';

/**
 * Fetch transcripts for a list of Gong call IDs.
 * POST /v2/calls/transcript with { filter: { callIds: [...] } }
 */
export async function fetchGongTranscripts(
  creds: GongCredentials,
  callIds: readonly string[],
): Promise<FetchResult<GongTranscriptResponse>> {
  if (callIds.length === 0) {
    return { ok: true, data: { callTranscripts: [] } };
  }

  try {
    const data = await withRetry(
      () => gongPost<GongTranscriptResponse>(
        creds,
        '/v2/calls/transcript',
        { filter: { callIds: [...callIds] } },
      ),
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        retryOn: isRetryableHttpError,
      },
    );
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, source: 'gong_transcripts' };
  }
}

/**
 * Fetch extensive call data (topics, trackers, action items, insights).
 * POST /v2/calls/extensive with { filter: { callIds: [...] }, contentSelector: {...} }
 */
export async function fetchGongExtensive(
  creds: GongCredentials,
  callIds: readonly string[],
): Promise<FetchResult<GongExtensiveResponse>> {
  if (callIds.length === 0) {
    return { ok: true, data: { calls: [] } };
  }

  try {
    const data = await withRetry(
      () => gongPost<GongExtensiveResponse>(
        creds,
        '/v2/calls/extensive',
        {
          filter: { callIds: [...callIds] },
          contentSelector: {
            exposedFields: {
              content: {
                topics: true,
                trackers: true,
                pointsOfInterest: true,
              },
              collaboration: {
                publicComments: true,
              },
              interaction: {
                speakers: true,
              },
            },
          },
        },
      ),
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        retryOn: isRetryableHttpError,
      },
    );
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, source: 'gong_extensive' };
  }
}

// ── HTTP helper ─────────────────────────────────────────────

async function gongPost<T>(
  creds: GongCredentials,
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${creds.baseUrl}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildGongAuthHeader(creds),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new FetchError(
      `Gong API ${path} failed (${response.status}): ${text}`,
      'gong',
      response.status,
    );
  }

  return (await response.json()) as T;
}
