/**
 * Type validators for extracted field values.
 *
 * Each validator returns both a `cleanedValue` (potentially modified — e.g.
 * for multipicklist, invalid values are stripped) and an array of error
 * messages. Callers should write `cleanedValue` (not the original) if errors
 * is empty.
 */

import type { FieldConfig } from '../types/field-config';

export type FieldValidationResult = {
  /**
   * The value to actually write, after any safe cleaning.
   * - multipicklist: invalid options stripped, valid ones kept
   * - all others: unchanged from input (or null if unusable)
   */
  readonly cleanedValue: string | null;
  /** Human-readable validation errors. If non-empty, the caller may still write cleanedValue for multipicklist (partial success). */
  readonly errors: readonly string[];
  /** True if the caller should write the field. False means either clean null or a hard error. */
  readonly safeToWrite: boolean;
};

export function validateFieldValue(
  value: string | null,
  config: FieldConfig,
): FieldValidationResult {
  if (value === null) return { cleanedValue: null, errors: [], safeToWrite: false };

  switch (config.valueType) {
    case 'picklist':
      return validatePicklist(value, config);
    case 'multipicklist':
      return validateMultipicklist(value, config);
    case 'text':
    case 'textarea':
      return validateText(value, config);
    case 'number':
      return validateNumber(value, config);
    case 'date':
      return validateDate(value, config);
    case 'datetime':
      return validateDatetime(value, config);
    case 'boolean':
      return validateBoolean(value);
    default:
      return { cleanedValue: value, errors: [], safeToWrite: true };
  }
}

// ── Picklist ────────────────────────────────────────────────

function validatePicklist(value: string, config: FieldConfig): FieldValidationResult {
  if (!config.options || config.options.length === 0) {
    return { cleanedValue: value, errors: [], safeToWrite: true };
  }

  if (config.options.includes(value)) {
    return { cleanedValue: value, errors: [], safeToWrite: true };
  }

  return {
    cleanedValue: null,
    errors: [
      `Invalid picklist value "${value}" for ${config.fieldName}. ` +
      `Valid options: ${config.options.join(', ')}`,
    ],
    safeToWrite: false,
  };
}

// ── Multipicklist ───────────────────────────────────────────

function validateMultipicklist(value: string, config: FieldConfig): FieldValidationResult {
  if (!config.options || config.options.length === 0) {
    return { cleanedValue: value, errors: [], safeToWrite: true };
  }

  const selectedValues = value.split(';').map((v) => v.trim()).filter(Boolean);

  if (selectedValues.length === 0) {
    return {
      cleanedValue: null,
      errors: [`Empty multipicklist value for ${config.fieldName}`],
      safeToWrite: false,
    };
  }

  const valid = selectedValues.filter((v) => config.options!.includes(v));
  const invalid = selectedValues.filter((v) => !config.options!.includes(v));

  if (invalid.length === 0) {
    return { cleanedValue: valid.join(';'), errors: [], safeToWrite: true };
  }

  // Partial match: keep valid ones, warn about stripped invalid ones.
  if (valid.length > 0) {
    return {
      cleanedValue: valid.join(';'),
      errors: [
        `Stripped ${invalid.length} invalid option(s) from ${config.fieldName}: ${invalid.join(', ')}. ` +
        `Kept ${valid.length} valid option(s): ${valid.join(', ')}.`,
      ],
      // Still safe to write — we have valid options left
      safeToWrite: true,
    };
  }

  // All values invalid — nothing to write
  return {
    cleanedValue: null,
    errors: [
      `All multipicklist values invalid for ${config.fieldName}: ${invalid.join(', ')}. ` +
      `Valid options: ${config.options.join(', ')}`,
    ],
    safeToWrite: false,
  };
}

// ── Text / Textarea ─────────────────────────────────────────

function validateText(value: string, config: FieldConfig): FieldValidationResult {
  if (config.validation?.maxLength !== undefined && value.length > config.validation.maxLength) {
    // Truncate rather than reject — prevents one slightly-too-long field from
    // losing its data. Add an error so the user knows truncation happened.
    const truncated = value.slice(0, config.validation.maxLength);
    return {
      cleanedValue: truncated,
      errors: [
        `Value truncated from ${value.length} to ${config.validation.maxLength} chars for ${config.fieldName}`,
      ],
      safeToWrite: true,
    };
  }
  return { cleanedValue: value, errors: [], safeToWrite: true };
}

// ── Number ──────────────────────────────────────────────────

function validateNumber(value: string, config: FieldConfig): FieldValidationResult {
  const num = Number(value);
  if (isNaN(num)) {
    return {
      cleanedValue: null,
      errors: [`"${value}" is not a valid number for ${config.fieldName}`],
      safeToWrite: false,
    };
  }

  const errors: string[] = [];
  if (config.validation?.min !== undefined && num < config.validation.min) {
    errors.push(`Value ${num} is below minimum ${config.validation.min} for ${config.fieldName}`);
  }
  if (config.validation?.max !== undefined && num > config.validation.max) {
    errors.push(`Value ${num} exceeds maximum ${config.validation.max} for ${config.fieldName}`);
  }

  return {
    cleanedValue: errors.length > 0 ? null : value,
    errors,
    safeToWrite: errors.length === 0,
  };
}

// ── Date ────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateDate(value: string, config: FieldConfig): FieldValidationResult {
  if (!DATE_REGEX.test(value)) {
    return {
      cleanedValue: null,
      errors: [`"${value}" is not a valid date (expected YYYY-MM-DD) for ${config.fieldName}`],
      safeToWrite: false,
    };
  }

  const parsed = new Date(value + 'T00:00:00Z');
  if (isNaN(parsed.getTime())) {
    return {
      cleanedValue: null,
      errors: [`"${value}" is not a valid date for ${config.fieldName}`],
      safeToWrite: false,
    };
  }

  return { cleanedValue: value, errors: [], safeToWrite: true };
}

// ── Datetime ────────────────────────────────────────────────

// Accept any ISO 8601 datetime with seconds and either a Z suffix or a numeric
// offset (e.g. -05:00, +0530). LLMs inconsistently emit local-tz offsets; we
// normalize to UTC Z on the way out.
const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function validateDatetime(value: string, config: FieldConfig): FieldValidationResult {
  if (!DATETIME_REGEX.test(value)) {
    return {
      cleanedValue: null,
      errors: [`"${value}" is not a valid datetime (expected YYYY-MM-DDTHH:MM:SSZ or with ±HH:MM offset) for ${config.fieldName}`],
      safeToWrite: false,
    };
  }

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return {
      cleanedValue: null,
      errors: [`"${value}" is not a valid datetime for ${config.fieldName}`],
      safeToWrite: false,
    };
  }

  // Normalize to canonical UTC form (YYYY-MM-DDTHH:MM:SSZ, no millis) so
  // downstream comparisons and SF writes are consistent regardless of the
  // timezone the LLM emitted.
  const normalized = parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');

  return { cleanedValue: normalized, errors: [], safeToWrite: true };
}

// ── Boolean ─────────────────────────────────────────────────

function validateBoolean(value: string): FieldValidationResult {
  const lower = value.toLowerCase().trim();
  if (lower === 'true' || lower === 'false') {
    return { cleanedValue: lower, errors: [], safeToWrite: true };
  }
  return {
    cleanedValue: null,
    errors: [`"${value}" is not a valid boolean (expected "true" or "false")`],
    safeToWrite: false,
  };
}
