/**
 * OpenAI API client wrapper for field extraction.
 *
 * - gpt-4o for extraction (structured JSON output)
 * - gpt-4o-mini for summarization (cost savings)
 *
 * Includes retry with exponential backoff on 429/5xx.
 */

import OpenAI from 'openai';
import { withRetry } from '../utils/retry';
import { ExtractionError } from '../errors';

/** Models used by the data entry agent. */
export const EXTRACTION_MODEL = 'gpt-4o' as const;
export const SUMMARIZATION_MODEL = 'gpt-4o-mini' as const;

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ExtractionError(
      'OPENAI_API_KEY not configured. Set it in .env.local.',
      'setup',
    );
  }

  _client = new OpenAI({ apiKey });
  return _client;
}

export type ExtractionRequest = {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly batchId: string;
  readonly maxTokens?: number;
};

export type ExtractionResponse = {
  readonly content: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly model: string;
};

/**
 * Call OpenAI for field extraction with structured JSON output.
 * Retries on rate limit (429) and server errors (5xx).
 */
export async function extractWithOpenAI(
  request: ExtractionRequest,
): Promise<ExtractionResponse> {
  const client = getClient();

  return withRetry(
    async () => {
      const response = await client.chat.completions.create({
        model: EXTRACTION_MODEL,
        response_format: { type: 'json_object' },
        // 16384 is gpt-4o's max output. With 80+ fields × ~100 tokens each we
        // need substantial headroom; the old 4096 would have truncated responses
        // once we switched to single-call extraction.
        max_tokens: request.maxTokens ?? 16384,
        temperature: 0.1,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
      });

      const choice = response.choices[0];
      if (!choice?.message?.content) {
        throw new ExtractionError(
          `OpenAI returned empty response for batch ${request.batchId}`,
          request.batchId,
        );
      }

      return {
        content: choice.message.content,
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        model: response.model,
      };
    },
    {
      maxAttempts: 3,
      baseDelayMs: 3000,
      retryOn: isOpenAIRetryable,
    },
  );
}

/**
 * Call OpenAI for transcript summarization (cheaper model).
 */
export async function summarizeWithOpenAI(
  text: string,
  instruction: string,
): Promise<string> {
  const client = getClient();

  const response = await withRetry(
    async () => {
      return client.chat.completions.create({
        model: SUMMARIZATION_MODEL,
        max_tokens: 2048,
        temperature: 0.2,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: text },
        ],
      });
    },
    {
      maxAttempts: 2,
      baseDelayMs: 2000,
      retryOn: isOpenAIRetryable,
    },
  );

  return response.choices[0]?.message?.content ?? '';
}

function isOpenAIRetryable(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    return error.status === 429 || (error.status !== undefined && error.status >= 500);
  }
  // Network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  return false;
}

/**
 * Clear the cached OpenAI client (useful for testing).
 */
export function clearOpenAIClient(): void {
  _client = null;
}
