/**
 * Build extraction prompts for each batch.
 *
 * Each prompt includes:
 * 1. A system prompt explaining the extraction task and output format
 * 2. A user prompt with the relevant context + field-specific instructions
 */

import type { FieldConfig } from '../types/field-config';
import type { CompiledContext } from '../types/pipeline';
import { selectContextForBatch, selectAllContext } from '../context/compiler';
import { BATCH_CONFIG_MAP, BATCH_CONFIGS } from '../config/batches';

/** The system prompt used for all extraction batches. */
export const EXTRACTION_SYSTEM_PROMPT = `You are a data extraction assistant for a B2B SaaS sales team. Your job is to extract specific field values from sales conversations, emails, and CRM data.

EVIDENCE HIERARCHY (most to least authoritative):
1. Call transcript quotes (direct speech from the prospect, AE, or others on the call)
2. Email body content (inbound from prospect, outbound from AE)
3. Activity descriptions (SMS logs, Task notes, Event notes)
4. Outreach mailing content (sales sequences sent to the prospect)
5. Free-text Salesforce notes fields populated by humans (NOT AI_* fields)

You MUST base every extraction on evidence from the hierarchy above. The "evidence"
field in your response must be a direct quote or clear paraphrase from one of those
sources — name the source when possible (e.g. "From Gong transcript:", "From email:").

DO NOT use these as evidence:
- Existing AI_* custom fields on Salesforce records (these are stale outputs from
  prior runs of this agent and may be wrong)
- Other derived or computed fields on Salesforce (Opportunity Amount, Stage, etc.
  unless those are the specific field you're asked to populate)
- Information that you know from general training but isn't in the provided context

If you cannot find direct evidence in the allowed sources, return null. Confidence
must reflect the strength of the evidence: "high" only for direct quotes, "medium"
for clear paraphrase, "low" for weak implications.

CRITICAL RULES:
1. Only extract information that is EXPLICITLY stated or clearly implied in the provided context.
2. NEVER fabricate, guess, or infer information that is not supported by the evidence.
3. If the information is not available, return null for the value — do NOT omit the field.
4. You MUST return one entry in the "extractions" array for EVERY field listed in the request, using null for value when unknown. Skipping fields is not allowed.
5. For picklist fields, you MUST use EXACTLY one of the provided options. If none match, return null.
6. For multipicklist fields, return a semicolon-separated string of matching options.
7. For dates, use YYYY-MM-DD format.
8. For datetimes, use YYYY-MM-DDTHH:MM:SSZ format (UTC).
9. For numbers, return the numeric value only (no commas, no currency symbols).
10. For booleans, return "true" or "false" (lowercase strings).

OUTPUT FORMAT:
Return a JSON object with this structure:
{
  "extractions": [
    {
      "fieldName": "AI_Field_Name__c",
      "value": "extracted value or null",
      "confidence": "high" | "medium" | "low",
      "evidence": "Brief quote or reference from the source material that supports this extraction"
    }
  ]
}

CONFIDENCE GUIDELINES:
- "high": Information is directly stated (exact quote or clear statement)
- "medium": Information is strongly implied or requires minor inference
- "low": Information requires significant interpretation or is ambiguous`;

/**
 * Build the user prompt for a specific extraction batch.
 *
 * Structure:
 *   1. Context sections (selected per batch config)
 *   2. Field extraction instructions (one per field in the batch)
 */
export function buildBatchPrompt(
  batchId: string,
  fields: readonly FieldConfig[],
  context: CompiledContext,
): string {
  const batchConfig = BATCH_CONFIG_MAP.get(batchId);
  const sectionKeys = batchConfig?.contextSections ?? ['sfObjects'];

  // Select relevant context
  const contextText = selectContextForBatch(context, sectionKeys);

  // Build field instructions
  const fieldInstructions = fields.map((field) => {
    const parts: string[] = [
      `### ${field.fieldName} (${field.sfObject})`,
      `Type: ${field.valueType}`,
      `Instruction: ${field.instruction}`,
    ];

    if (field.options && field.options.length > 0) {
      parts.push(`Valid options: ${field.options.join(', ')}`);
    }

    if (field.validation) {
      const rules: string[] = [];
      if (field.validation.min !== undefined) rules.push(`min: ${field.validation.min}`);
      if (field.validation.max !== undefined) rules.push(`max: ${field.validation.max}`);
      if (field.validation.maxLength !== undefined) rules.push(`maxLength: ${field.validation.maxLength}`);
      if (field.validation.dateFormat) rules.push(`format: ${field.validation.dateFormat}`);
      if (rules.length > 0) {
        parts.push(`Validation: ${rules.join(', ')}`);
      }
    }

    return parts.join('\n');
  });

  return `# Context Data

${contextText}

---

# Fields to Extract

Extract the following ${fields.length} fields from the context above. Return a JSON object with the "extractions" array.

${fieldInstructions.join('\n\n')}`;
}

/**
 * Build a UNIFIED prompt containing all context + all fields.
 *
 * This is the default extraction mode (single OpenAI call per record),
 * which is ~9x cheaper and ~3x faster than the per-batch approach because
 * we stop re-sending the same context 13 times.
 *
 * Fields are grouped by batch in the prompt so the LLM can navigate them
 * logically (BANT fields together, MEDDPICC together, etc.).
 */
export function buildUnifiedPrompt(
  fields: readonly FieldConfig[],
  context: CompiledContext,
): string {
  const contextText = selectAllContext(context);

  // Group fields by batchId in BATCH_CONFIGS order
  const fieldsByBatch = new Map<string, FieldConfig[]>();
  for (const field of fields) {
    if (!fieldsByBatch.has(field.batchId)) fieldsByBatch.set(field.batchId, []);
    fieldsByBatch.get(field.batchId)!.push(field);
  }

  const groupedFieldSections: string[] = [];
  for (const batch of BATCH_CONFIGS) {
    const batchFields = fieldsByBatch.get(batch.batchId);
    if (!batchFields || batchFields.length === 0) continue;

    const fieldBlocks = batchFields.map((field) => formatFieldBlock(field));
    groupedFieldSections.push(
      `## ${batch.label}\n\n${fieldBlocks.join('\n\n')}`,
    );
  }

  // Handle any fields with unknown batchIds (shouldn't normally happen)
  const knownBatchIds = new Set<string>(BATCH_CONFIGS.map((b) => b.batchId));
  const orphanFields = fields.filter((f) => !knownBatchIds.has(f.batchId));
  if (orphanFields.length > 0) {
    const orphanBlocks = orphanFields.map((field) => formatFieldBlock(field));
    groupedFieldSections.push(`## Other\n\n${orphanBlocks.join('\n\n')}`);
  }

  return `# Context Data

${contextText}

---

# Fields to Extract

Extract the following ${fields.length} fields from the context above. Return a JSON object with an "extractions" array containing one entry for EVERY field (use null for value when the context provides no evidence).

Fields are grouped by thematic category below — you can cite evidence from any part of the context for any field.

${groupedFieldSections.join('\n\n')}`;
}

function formatFieldBlock(field: FieldConfig): string {
  const parts: string[] = [
    `### ${field.fieldName} (${field.sfObject})`,
    `Type: ${field.valueType}`,
    `Instruction: ${field.instruction}`,
  ];

  if (field.options && field.options.length > 0) {
    parts.push(`Valid options: ${field.options.join(', ')}`);
  }

  if (field.validation) {
    const rules: string[] = [];
    if (field.validation.min !== undefined) rules.push(`min: ${field.validation.min}`);
    if (field.validation.max !== undefined) rules.push(`max: ${field.validation.max}`);
    if (field.validation.maxLength !== undefined) rules.push(`maxLength: ${field.validation.maxLength}`);
    if (field.validation.dateFormat) rules.push(`format: ${field.validation.dateFormat}`);
    if (rules.length > 0) {
      parts.push(`Validation: ${rules.join(', ')}`);
    }
  }

  return parts.join('\n');
}
