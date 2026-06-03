/**
 * Parse structured JSON responses from the LLM into typed extraction results.
 */

import type { RawExtraction, Confidence } from '../types/extraction';
import type { FieldConfig } from '../types/field-config';

/** Shape of the expected LLM response. */
type LlmResponse = {
  extractions?: readonly {
    fieldName?: string;
    value?: string | number | boolean | null;
    confidence?: string;
    evidence?: string;
  }[];
};

/**
 * Parse the LLM's JSON response into typed RawExtraction objects.
 *
 * Handles:
 * - Malformed JSON (returns empty array)
 * - Missing fields (skipped)
 * - Invalid confidence values (defaults to 'low')
 * - Type coercion (numbers/booleans to strings)
 */
export function parseExtractionResponse(
  responseContent: string,
  expectedFields: readonly FieldConfig[],
): readonly RawExtraction[] {
  let parsed: LlmResponse;
  try {
    parsed = JSON.parse(responseContent) as LlmResponse;
  } catch {
    return [];
  }

  if (!parsed.extractions || !Array.isArray(parsed.extractions)) {
    return [];
  }

  const expectedFieldNames = new Set(expectedFields.map((f) => f.fieldName));

  const results: RawExtraction[] = [];

  for (const item of parsed.extractions) {
    if (!item.fieldName || !expectedFieldNames.has(item.fieldName)) {
      continue;
    }

    const value = normalizeValue(item.value);
    const confidence = normalizeConfidence(item.confidence);
    const evidence = typeof item.evidence === 'string' ? item.evidence : '';

    results.push({
      fieldName: item.fieldName,
      value,
      confidence,
      evidence,
    });
  }

  return results;
}

/**
 * Normalize the extracted value to a string or null.
 */
function normalizeValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Treat common null-like strings as null
    if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'n/a') {
      return null;
    }
    return trimmed;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return String(value);
}

/**
 * Normalize the confidence value to one of the three valid levels.
 */
function normalizeConfidence(confidence: unknown): Confidence {
  if (typeof confidence !== 'string') return 'low';

  const lower = confidence.toLowerCase().trim();
  if (lower === 'high') return 'high';
  if (lower === 'medium') return 'medium';
  return 'low';
}
