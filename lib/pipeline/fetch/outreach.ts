/**
 * Outreach API client for Phase 1b.
 *
 * 1 API call:
 *   GET /api/v2/mailings?filter[prospect][id]=<prospectId>
 *
 * Auth: OAuth2 Bearer token (refresh flow on 401).
 */

import type { OutreachCredentials, OutreachMailingResponse } from '../types/api-responses';
import type { FetchResult } from '../types/pipeline';
import { withRetry, isRetryableHttpError } from '../utils/retry';
import { FetchError } from '../errors';

/** In-memory token cache for Outreach OAuth2. */
type OutreachToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedOutreachToken: OutreachToken | null = null;

/**
 * Fetch mailings for a prospect from Outreach.
 * GET /api/v2/mailings filtered by prospect ID.
 */
export async function fetchOutreachMailings(
  creds: OutreachCredentials,
  prospectId: string,
): Promise<FetchResult<OutreachMailingResponse>> {
  if (!prospectId) {
    return { ok: true, data: { data: [] } };
  }

  try {
    const data = await withRetry(
      async () => {
        const token = await getOutreachToken(creds);

        const url = `${creds.baseUrl}/api/v2/mailings?filter[prospect][id]=${encodeURIComponent(prospectId)}&page[size]=50&sort=-deliveredAt`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.api+json',
          },
        });

        // Retry on 401 — token may have expired
        if (response.status === 401) {
          cachedOutreachToken = null;
          const freshToken = await getOutreachToken(creds);

          const retryResponse = await fetch(url, {
            headers: {
              Authorization: `Bearer ${freshToken}`,
              Accept: 'application/vnd.api+json',
            },
          });

          if (!retryResponse.ok) {
            const text = await retryResponse.text();
            throw new FetchError(
              `Outreach API failed after token refresh (${retryResponse.status}): ${text}`,
              'outreach',
              retryResponse.status,
            );
          }

          return (await retryResponse.json()) as OutreachMailingResponse;
        }

        if (!response.ok) {
          const text = await response.text();
          throw new FetchError(
            `Outreach API failed (${response.status}): ${text}`,
            'outreach',
            response.status,
          );
        }

        return (await response.json()) as OutreachMailingResponse;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        retryOn: isRetryableHttpError,
      },
    );

    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, source: 'outreach_mailings' };
  }
}

// ── OAuth2 token management ─────────────────────────────────

async function getOutreachToken(creds: OutreachCredentials): Promise<string> {
  if (cachedOutreachToken && Date.now() < cachedOutreachToken.expiresAt) {
    return cachedOutreachToken.accessToken;
  }

  const response = await fetch('https://api.outreach.io/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new FetchError(
      `Outreach token refresh failed (${response.status}): ${text}`,
      'outreach',
      response.status,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
  };

  cachedOutreachToken = {
    accessToken: data.access_token,
    // Expire 30s early as safety margin
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };

  return cachedOutreachToken.accessToken;
}

/**
 * Clear the cached Outreach token (useful for testing).
 */
export function clearOutreachTokenCache(): void {
  cachedOutreachToken = null;
}
