/**
 * Types for the 116 field configurations that define what the
 * Data Entry Agent extracts and writes to Salesforce.
 */

/** Salesforce objects the agent writes to. */
export type SfObject = 'Lead' | 'Opportunity';

/** Value types that determine validation rules. */
export type ValueType =
  | 'picklist'
  | 'multipicklist'
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean';

/** How the agent handles existing SF field values. */
export type WriteMode = 'overwrite' | 'fill_blank' | 'append';

/** Validation constraints applied before writing. */
export type ValidationRules = {
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly dateFormat?: 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM:SSZ';
};

/**
 * A single field extraction configuration.
 * Each config tells the agent: which SF field to populate, what type it is,
 * how to extract the value, and how to write it.
 */
export type FieldConfig = {
  /** Unique identifier for this field config (e.g., 'firmographic_buyer_persona'). */
  readonly id: string;
  /** Which SF object this field belongs to. */
  readonly sfObject: SfObject;
  /** Salesforce API field name (e.g., 'AI_Buyer_Persona__c'). */
  readonly fieldName: string;
  /** Data type — determines validation rules. */
  readonly valueType: ValueType;
  /** Which extraction batch this field belongs to. */
  readonly batchId: string;
  /** Natural language instruction for the LLM. */
  readonly instruction: string;
  /** How to handle existing values in SF. */
  readonly writeMode: WriteMode;
  /** Valid options for picklist/multipicklist fields. */
  readonly options?: readonly string[];
  /** Additional validation constraints. */
  readonly validation?: ValidationRules;
};

/** ID for one of the 14 extraction batches. */
export type BatchId =
  | 'firmographic'
  | 'discovery'
  | 'qualification'
  | 'competitive'
  | 'bant_budget'
  | 'bant_authority'
  | 'bant_need'
  | 'bant_timeline'
  | 'planning'
  | 'meddpicc_metrics_buyer'
  | 'meddpicc_decision'
  | 'meddpicc_paper_pain'
  | 'meddpicc_champion_comp'
  | 'deal_strength';

/** Context sections available for injection into extraction prompts. */
export type ContextSection =
  | 'sfObjects'
  | 'recentTranscript'
  | 'summaries'
  | 'emails'
  | 'sms'
  | 'activities'
  | 'outreachMailings';

/** A batch groups related fields and defines which context is relevant. */
export type BatchConfig = {
  readonly batchId: BatchId;
  readonly label: string;
  /** Which compiled context sections to include in the extraction prompt. */
  readonly contextSections: readonly ContextSection[];
  /** Token budget for this batch's prompt. */
  readonly maxTokens: number;
};
