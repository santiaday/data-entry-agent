/**
 * Types for AI extraction results and validation.
 */

import type { WriteMode } from './field-config';

/** Confidence level returned by the LLM. */
export type Confidence = 'high' | 'medium' | 'low';

/** Raw extraction result from the LLM for a single field. */
export type RawExtraction = {
  readonly fieldName: string;
  readonly value: string | null;
  readonly confidence: Confidence;
  readonly evidence: string;
};

/** Numeric confidence mapped from the LLM's categorical confidence. */
export function confidenceToScore(confidence: Confidence): number {
  switch (confidence) {
    case 'high':
      return 0.95;
    case 'medium':
      return 0.75;
    case 'low':
      return 0.4;
  }
}

/** Result of extracting all fields in a batch. */
export type BatchExtractionResult =
  | {
      readonly ok: true;
      readonly batchId: string;
      readonly extractions: readonly RawExtraction[];
    }
  | {
      readonly ok: false;
      readonly batchId: string;
      readonly error: string;
    };

/** A fully validated extraction ready for write decision. */
export type ValidatedExtraction = {
  readonly fieldName: string;
  readonly sfObject: string;
  readonly batchId: string;
  readonly extractedValue: string | null;
  readonly currentSfValue: string | null;
  readonly confidence: number;
  readonly evidence: string;
  readonly writeMode: WriteMode;
  readonly wasWritten: boolean;
  readonly skipReason: string | null;
  readonly validationErrors: readonly string[];
  /**
   * For non-dry runs: the field value observed in SF after the write + a
   * verification re-query. Null for dry runs or if verification failed.
   * Used to detect SF silent-drop scenarios (FLS, validation-suppressed).
   */
  readonly actualSfValueAfterWrite?: string | null;
};

/** Result of writing fields to a single SF sObject record. */
export type WriteResult = {
  readonly objectType: string;
  readonly recordId: string;
  readonly fieldsAttempted: number;
  readonly fieldsWritten: number;
  readonly error: string | null;
};

/** Aggregated per-object write + verification summary for run-level logging. */
export type VerifiedWriteResult = {
  readonly objectType: string;
  readonly recordId: string;
  readonly fieldsAttempted: number;
  /** SF returned 204 and post-write verification found the expected value. */
  readonly fieldsVerifiedWritten: number;
  /**
   * SF returned success but re-query shows the old value — almost always a
   * field-level-security (FLS) restriction on the API user's profile.
   */
  readonly silentlyDropped: number;
  readonly error: string | null;
};
