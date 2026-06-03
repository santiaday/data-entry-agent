/**
 * lib/pipeline — AI-powered Salesforce field extraction pipeline.
 *
 * Public API consumed by the Next.js API routes and the backfill CLI
 * (scripts/backfill.ts). This module is import-safe: it has no top-level
 * side effects. The CLI entrypoint lives in scripts/backfill.ts.
 */

export {
  FIELD_CONFIGS,
  BATCH_CONFIGS,
  getFieldsByBatch,
  getFieldsByObject,
  loadFieldConfigs,
  seedFieldConfigsFromCode,
  loadActivePrompt,
  loadActivePromptRow,
  seedDefaultPrompt,
  type ActivePrompt,
} from './config';
export { EXTRACTION_SYSTEM_PROMPT } from './extract/prompt-builder';
export type { FieldConfig, BatchConfig, BatchId, WriteMode, ValueType } from './types';
export type { RunInput, BatchInput, RunResult, BatchResult, PipelineEvent } from './types';
export { runPipeline, type RunPipelineParams } from './run';
export {
  createBatch,
  completeBatch,
  createRun,
  completeRun,
  logExtractions,
} from './logging';
