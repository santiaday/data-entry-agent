/**
 * Phase 4b: Salesforce sObject writer.
 *
 * Groups validated extractions by (objectType, recordId) and sends
 * one PATCH per group. Each PATCH is independent — a failed Lead write
 * does not block the Opportunity write.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SalesforceTokenCache } from '@/lib/sf';
import type { ValidatedExtraction, WriteResult } from '../types/extraction';
import { patchSObject } from '../utils/sf-rest';

export type SfWriteParams = {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly tokenCache: SalesforceTokenCache;
  readonly extractions: readonly ValidatedExtraction[];
  readonly recordIds: Record<string, string>;
};

/**
 * Enhanced write result that includes per-field rejections. SF's auto-retry
 * logic in patchSObject peels off rejected fields (e.g. "bad value for
 * restricted picklist field: X") and retries the remaining. We surface those
 * rejections here so downstream verification can mark each field correctly.
 */
export type SfWriteResult = WriteResult & {
  readonly rejectedFields: Record<string, string>;
};

/**
 * Write validated extractions to Salesforce.
 *
 * Groups fields by (sfObject), looks up the recordId for each object,
 * and sends one PATCH per object. Each PATCH auto-retries on field-rejection
 * errors so a single bad picklist value doesn't nuke the whole batch.
 */
export async function writeToSalesforce(
  params: SfWriteParams,
): Promise<readonly SfWriteResult[]> {
  const { supabase, orgId, tokenCache, extractions, recordIds } = params;

  // Group extractions by sfObject
  const groups = new Map<string, { fields: Record<string, unknown>; count: number }>();

  for (const ext of extractions) {
    if (!ext.wasWritten) continue;

    const key = ext.sfObject;
    if (!groups.has(key)) {
      groups.set(key, { fields: {}, count: 0 });
    }
    const group = groups.get(key)!;
    group.fields[ext.fieldName] = coerceForSalesforce(ext.extractedValue, ext);
    group.count++;
  }

  const results: SfWriteResult[] = [];

  const patchPromises = [...groups.entries()].map(async ([objectType, group]) => {
    const recordId = recordIds[objectType];
    if (!recordId) {
      results.push({
        objectType,
        recordId: '',
        fieldsAttempted: group.count,
        fieldsWritten: 0,
        error: `No recordId found for ${objectType}`,
        rejectedFields: {},
      });
      return;
    }

    const patchResult = await patchSObject({
      supabase,
      orgId,
      tokenCache,
      objectType,
      recordId,
      fields: group.fields,
    });

    const rejectedFields = patchResult.rejectedFields ?? {};
    const rejectedCount = Object.keys(rejectedFields).length;

    results.push({
      objectType,
      recordId,
      fieldsAttempted: group.count,
      // On success: every attempted field minus the rejections landed.
      // On failure: zero fields landed.
      fieldsWritten: patchResult.ok ? group.count - rejectedCount : 0,
      error: patchResult.error ?? null,
      rejectedFields,
    });
  });

  await Promise.all(patchPromises);
  return results;
}

/**
 * Coerce a string value to the appropriate JS type for the SF REST API.
 * SF expects: strings for text, numbers for number fields, booleans for checkboxes.
 */
function coerceForSalesforce(
  value: string | null,
  extraction: ValidatedExtraction,
): unknown {
  if (value === null) return null;

  // Look up the field config to determine value type
  // The extraction stores the batchId but not the valueType directly,
  // so we infer from the field name pattern
  const fieldName = extraction.fieldName;

  // Boolean fields
  if (fieldName.includes('__c') && value === 'true') return true;
  if (fieldName.includes('__c') && value === 'false') return false;

  // Number fields (Score, Units, etc.)
  if (
    fieldName.includes('Score__c') ||
    fieldName.includes('Units__c') ||
    fieldName.includes('Likelihood__c')
  ) {
    const num = Number(value);
    if (!isNaN(num)) return num;
  }

  return value;
}
