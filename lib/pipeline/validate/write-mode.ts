/**
 * Write mode logic: compare extracted values against current SF values
 * and determine whether to write.
 *
 * Write modes:
 *   - overwrite: always write (even if current value exists)
 *   - fill_blank: only write if current SF value is empty/null
 *   - append: concatenate new value to existing with dated separator
 */

import type { WriteMode } from '../types/field-config';

export type WriteDecision = {
  readonly shouldWrite: boolean;
  readonly finalValue: string | null;
  readonly skipReason: string | null;
};

/**
 * Determine whether to write an extracted value based on write mode
 * and the current SF value.
 */
export function decideWrite(params: {
  readonly extractedValue: string | null;
  readonly currentSfValue: string | null;
  readonly writeMode: WriteMode;
  readonly dryRun: boolean;
}): WriteDecision {
  const { extractedValue, currentSfValue, writeMode, dryRun } = params;

  // No value extracted — nothing to write
  if (extractedValue === null) {
    return { shouldWrite: false, finalValue: null, skipReason: 'no_value_extracted' };
  }

  // Dry run — log but don't write
  if (dryRun) {
    const finalValue = computeFinalValue(extractedValue, currentSfValue, writeMode);
    return { shouldWrite: false, finalValue, skipReason: 'dry_run' };
  }

  switch (writeMode) {
    case 'overwrite':
      return { shouldWrite: true, finalValue: extractedValue, skipReason: null };

    case 'fill_blank': {
      if (isNonEmpty(currentSfValue)) {
        return { shouldWrite: false, finalValue: extractedValue, skipReason: 'field_not_blank' };
      }
      return { shouldWrite: true, finalValue: extractedValue, skipReason: null };
    }

    case 'append': {
      const finalValue = appendValue(extractedValue, currentSfValue);
      return { shouldWrite: true, finalValue, skipReason: null };
    }
  }
}

/**
 * Compute the final value that would be written (used for dry run display).
 */
function computeFinalValue(
  extractedValue: string,
  currentSfValue: string | null,
  writeMode: WriteMode,
): string {
  switch (writeMode) {
    case 'overwrite':
      return extractedValue;
    case 'fill_blank':
      return isNonEmpty(currentSfValue) ? currentSfValue! : extractedValue;
    case 'append':
      return appendValue(extractedValue, currentSfValue);
  }
}

/**
 * Append a new value to an existing value with a dated separator.
 */
function appendValue(newValue: string, existingValue: string | null): string {
  if (!isNonEmpty(existingValue)) {
    return newValue;
  }

  const date = new Date().toISOString().split('T')[0];
  return `${existingValue}\n\n--- AI Update (${date}) ---\n${newValue}`;
}

function isNonEmpty(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim().length > 0;
}
