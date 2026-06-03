/**
 * Generic retry with exponential backoff.
 * Used by the OpenAI client, Gong/Outreach fetchers, and SF writer.
 */

export type RetryOptions = {
  /** Maximum number of attempts (including the first). Default: 3. */
  readonly maxAttempts?: number;
  /** Base delay in ms before the first retry. Default: 1000. */
  readonly baseDelayMs?: number;
  /** Maximum delay in ms (caps exponential growth). Default: 30000. */
  readonly maxDelayMs?: number;
  /** Predicate: should we retry this error? Default: always retry. */
  readonly retryOn?: (error: unknown) => boolean;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Execute an async function with retry and exponential backoff.
 *
 * Delay formula: min(baseDelayMs * 2^(attempt-1), maxDelayMs) + jitter
 * Jitter is ±25% to avoid thundering herd.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const retryOn = options.retryOn ?? (() => true);

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !retryOn(error)) {
        throw error;
      }

      const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
      // Add ±25% jitter
      const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
      const delay = Math.max(0, cappedDelay + jitter);

      await sleep(delay);
    }
  }

  // TypeScript: this is unreachable but satisfies the compiler
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error has an HTTP status code that warrants retrying.
 * Retries on: 429 (rate limit), 500, 502, 503, 504 (server errors).
 */
export function isRetryableHttpError(error: unknown): boolean {
  if (error instanceof Error && 'statusCode' in error) {
    const status = (error as Error & { statusCode: number }).statusCode;
    return status === 429 || status >= 500;
  }
  // Also check for generic fetch errors (network failures)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  return false;
}
