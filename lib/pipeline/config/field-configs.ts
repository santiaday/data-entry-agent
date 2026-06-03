/**
 * All 116 field extraction configurations.
 *
 * 35 fields write to Lead, 82 fields write to Opportunity.
 * (35 shared fields exist on both objects + 47 Opp-only fields.)
 *
 * Ported exactly from the n8n Data Entry Agent workflow —
 * same field names, validation rules, picklist options, and extraction instructions.
 */

import type { FieldConfig } from '../types/field-config';
import {
  BUYER_PERSONA,
  PORTFOLIO_TYPE,
  PORTFOLIO_SUBTYPE,
  US_STATES,
  BUYING_SCENARIO,
  PM_SOFTWARE,
  DOORLOOP_FEATURES,
  DEAL_COMPLEXITY,
  TIMELINE_PICKLIST,
  RECOMMENDED_PLAN,
  RECOMMENDED_TERM,
  DISCOUNT_DISCUSSED,
  DECISION_PROCESS_COMPLEXITY,
  SUBSCRIPTION_LOSS_REASON,
} from './picklist-values';

// ── Firmographic (shared Lead + Opp) ───────────────────────

const firmographicLead: readonly FieldConfig[] = [
  {
    id: 'firmographic_buyer_persona_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Buyer_Persona__c',
    valueType: 'picklist',
    batchId: 'firmographic',
    instruction: 'Determine the buyer persona. Is this person a Property Owner, Property Manager, or both? Use "Other" only if clearly none of the above.',
    writeMode: 'overwrite',
    options: BUYER_PERSONA,
  },
  {
    id: 'firmographic_buyer_persona_other_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Buyer_Persona_Other__c',
    valueType: 'text',
    batchId: 'firmographic',
    instruction: 'If buyer persona is "Other", describe their role. Leave blank if not applicable.',
    writeMode: 'overwrite',
    validation: { maxLength: 255 },
  },
  {
    id: 'firmographic_expected_units_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Expected_Units__c',
    valueType: 'number',
    batchId: 'firmographic',
    instruction: 'How many units does the prospect expect to manage with DoorLoop? Extract from conversations about portfolio size, growth plans, or onboarding scope.',
    writeMode: 'overwrite',
    validation: { min: 0 },
  },
  {
    id: 'firmographic_managed_units_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Managed_Units__c',
    valueType: 'number',
    batchId: 'firmographic',
    instruction: 'How many units does the prospect currently manage in total? This may differ from expected units if they plan to onboard only a subset.',
    writeMode: 'overwrite',
    validation: { min: 0 },
  },
  {
    id: 'firmographic_portfolio_type_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Portfolio_Type__c',
    valueType: 'picklist',
    batchId: 'firmographic',
    instruction: 'What type of portfolio does the prospect manage? Rentals (apartments, houses, commercial leases) or Condos/Associations (HOA).',
    writeMode: 'overwrite',
    options: PORTFOLIO_TYPE,
  },
  {
    id: 'firmographic_portfolio_subtype_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Portfolio_Subtype__c',
    valueType: 'picklist',
    batchId: 'firmographic',
    instruction: 'Is the portfolio Residential, Commercial, or both?',
    writeMode: 'overwrite',
    options: PORTFOLIO_SUBTYPE,
  },
  {
    id: 'firmographic_primary_state_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Primary_State__c',
    valueType: 'picklist',
    batchId: 'firmographic',
    instruction: 'What US state is the majority of the prospect\'s portfolio located in? Use "Other" for non-US.',
    writeMode: 'overwrite',
    options: US_STATES,
  },
];

const firmographicOpp: readonly FieldConfig[] = firmographicLead.map((f) => ({
  ...f,
  id: f.id.replace('_lead', '_opp'),
  sfObject: 'Opportunity' as const,
}));

// ── Discovery (shared Lead + Opp) ──────────────────────────

const discoveryLead: readonly FieldConfig[] = [
  {
    id: 'discovery_buying_scenario_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Buying_Scenario__c',
    valueType: 'picklist',
    batchId: 'discovery',
    instruction: 'What is the prospect\'s buying scenario? Are they using manual methods, patching tools together, switching from a competitor, just acquiring properties, or just starting a PM company?',
    writeMode: 'overwrite',
    options: BUYING_SCENARIO,
  },
  {
    id: 'discovery_buying_scenario_other_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Buying_Scenario_Other__c',
    valueType: 'text',
    batchId: 'discovery',
    instruction: 'If buying scenario is "Other", describe it. Leave blank if not applicable.',
    writeMode: 'overwrite',
    validation: { maxLength: 255 },
  },
  {
    id: 'discovery_current_software_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Current_Software__c',
    valueType: 'picklist',
    batchId: 'discovery',
    instruction: 'What property management software does the prospect currently use? Match to the closest option. Use "None" if they have no PM software.',
    writeMode: 'overwrite',
    options: PM_SOFTWARE,
  },
  {
    id: 'discovery_main_challenges_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Main_Challenges__c',
    valueType: 'textarea',
    batchId: 'discovery',
    instruction: 'What are the prospect\'s main pain points or challenges with their current workflow? Summarize the key challenges mentioned in conversations.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'discovery_feature_mentions_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Feature_Mentions__c',
    valueType: 'multipicklist',
    batchId: 'discovery',
    instruction: 'Which DoorLoop features were mentioned or discussed? Select all that apply based on conversations, demos, and emails.',
    writeMode: 'overwrite',
    options: DOORLOOP_FEATURES,
  },
];

const discoveryOpp: readonly FieldConfig[] = discoveryLead.map((f) => ({
  ...f,
  id: f.id.replace('_lead', '_opp'),
  sfObject: 'Opportunity' as const,
}));

// ── Qualification (shared Lead + Opp, plus Opp-only) ───────

const qualificationLead: readonly FieldConfig[] = [
  {
    id: 'qualification_go_live_date_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Go_Live_Date__c',
    valueType: 'date',
    batchId: 'qualification',
    instruction: 'When does the prospect want to go live with DoorLoop? Extract a specific date if mentioned, otherwise leave blank.',
    writeMode: 'fill_blank',
    validation: { dateFormat: 'YYYY-MM-DD' },
  },
  {
    id: 'qualification_decision_criteria_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Decision_Criteria__c',
    valueType: 'textarea',
    batchId: 'qualification',
    instruction: 'What criteria will the prospect use to make their decision? List the key factors they mentioned (price, features, support, integrations, etc.).',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'qualification_stakeholders_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Stakeholders__c',
    valueType: 'textarea',
    batchId: 'qualification',
    instruction: 'Who are the key stakeholders involved in the decision? List names, titles, and roles in the buying process if available.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'qualification_deal_complexity_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Deal_Complexity__c',
    valueType: 'picklist',
    batchId: 'qualification',
    instruction: 'How complex is this deal? Simple (single decision maker, small portfolio), Standard (multiple stakeholders, mid-size portfolio), Complex (enterprise, multiple properties/entities, custom requirements).',
    writeMode: 'overwrite',
    options: DEAL_COMPLEXITY,
  },
];

const qualificationOpp: readonly FieldConfig[] = [
  ...qualificationLead.map((f) => ({
    ...f,
    id: f.id.replace('_lead', '_opp'),
    sfObject: 'Opportunity' as const,
  })),
  {
    id: 'qualification_deal_complexity_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Deal_Complexity_Score__c',
    valueType: 'number',
    batchId: 'qualification',
    instruction: 'Rate the overall deal complexity on a scale of 1-10. Consider number of stakeholders, portfolio size, custom requirements, integration needs, and procurement process complexity.',
    writeMode: 'overwrite',
    validation: { min: 1, max: 10 },
  },
];

// ── Competitive (shared Lead + Opp) ────────────────────────

const competitiveLead: readonly FieldConfig[] = [
  {
    id: 'competitive_evaluating_competitors_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Evaluating_Competitors__c',
    valueType: 'multipicklist',
    batchId: 'competitive',
    instruction: 'Which other property management software products is the prospect evaluating? Select all mentioned in conversations or emails.',
    writeMode: 'overwrite',
    options: PM_SOFTWARE,
  },
  {
    id: 'competitive_objections_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Objections__c',
    valueType: 'textarea',
    batchId: 'competitive',
    instruction: 'What objections has the prospect raised? Include pricing concerns, feature gaps, switching costs, contract terms, or any other hesitations.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'competitive_ae_objection_handling_lead',
    sfObject: 'Lead',
    fieldName: 'AI_AE_Objection_Handling__c',
    valueType: 'textarea',
    batchId: 'competitive',
    instruction: 'How did the AE handle or respond to the prospect\'s objections? Summarize the key responses and strategies used.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
];

const competitiveOpp: readonly FieldConfig[] = competitiveLead.map((f) => ({
  ...f,
  id: f.id.replace('_lead', '_opp'),
  sfObject: 'Opportunity' as const,
}));

// ── BANT — Budget (shared Lead + Opp) ──────────────────────

const bantBudgetLead: readonly FieldConfig[] = [
  {
    id: 'bant_budget_score_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Budget_Score__c',
    valueType: 'number',
    batchId: 'bant_budget',
    instruction: 'Rate the prospect\'s budget readiness on a scale of 0-10. 0 = no budget discussed, 5 = budget exists but not confirmed, 10 = budget confirmed and approved.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'bant_budget_free_text_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Budget_Free_Text__c',
    valueType: 'textarea',
    batchId: 'bant_budget',
    instruction: 'Summarize any budget-related information discussed. Include specific amounts, budget cycles, approval processes, or constraints mentioned.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'bant_budget_timestamp_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Budget_Timestamp__c',
    valueType: 'datetime',
    batchId: 'bant_budget',
    instruction: 'When was budget most recently discussed? Use the date/time of the most recent conversation or email where budget was mentioned.',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'bant_budget_notes_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Budget_Notes__c',
    valueType: 'textarea',
    batchId: 'bant_budget',
    instruction: 'Additional notes about budget context, including any red flags or positive signals about budget availability.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
];

const bantBudgetOpp: readonly FieldConfig[] = bantBudgetLead.map((f) => ({
  ...f,
  id: f.id.replace('_lead', '_opp'),
  sfObject: 'Opportunity' as const,
}));

// ── BANT — Authority (shared Lead + Opp) ───────────────────

const bantAuthorityLead: readonly FieldConfig[] = [
  {
    id: 'bant_authority_score_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Authority_Score__c',
    valueType: 'number',
    batchId: 'bant_authority',
    instruction: 'Rate the prospect\'s decision-making authority on a scale of 0-10. 0 = no authority identified, 5 = influencer but not decision maker, 10 = confirmed final decision maker.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'bant_authority_free_text_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Authority_Free_Text__c',
    valueType: 'textarea',
    batchId: 'bant_authority',
    instruction: 'Summarize the authority structure. Who are the decision makers? Who influences? What is the approval chain?',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'bant_authority_timestamp_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Authority_Timestamp__c',
    valueType: 'datetime',
    batchId: 'bant_authority',
    instruction: 'When was authority/decision-making most recently discussed?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'bant_authority_notes_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Authority_Notes__c',
    valueType: 'textarea',
    batchId: 'bant_authority',
    instruction: 'Additional notes about the decision-making process, politics, or authority dynamics.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
];

const bantAuthorityOpp: readonly FieldConfig[] = bantAuthorityLead.map((f) => ({
  ...f,
  id: f.id.replace('_lead', '_opp'),
  sfObject: 'Opportunity' as const,
}));

// ── BANT — Need (shared Lead + Opp) ────────────────────────

const bantNeedLead: readonly FieldConfig[] = [
  {
    id: 'bant_need_score_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Need_Score__c',
    valueType: 'number',
    batchId: 'bant_need',
    instruction: 'Rate the prospect\'s need urgency on a scale of 0-10. 0 = no clear need, 5 = pain exists but not urgent, 10 = critical urgent need with clear pain points.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'bant_need_free_text_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Need_Free_Text__c',
    valueType: 'textarea',
    batchId: 'bant_need',
    instruction: 'Summarize the prospect\'s needs. What problems are they trying to solve? What are the consequences of not solving them?',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'bant_need_timestamp_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Need_Timestamp__c',
    valueType: 'datetime',
    batchId: 'bant_need',
    instruction: 'When was the prospect\'s need most recently discussed or validated?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'bant_need_notes_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Need_Notes__c',
    valueType: 'textarea',
    batchId: 'bant_need',
    instruction: 'Additional notes about the prospect\'s need, including any evolving requirements or changing priorities.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
];

const bantNeedOpp: readonly FieldConfig[] = bantNeedLead.map((f) => ({
  ...f,
  id: f.id.replace('_lead', '_opp'),
  sfObject: 'Opportunity' as const,
}));

// ── BANT — Timeline (shared Lead + Opp) ────────────────────

const bantTimelineLead: readonly FieldConfig[] = [
  {
    id: 'bant_timeline_score_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Timeline_Score__c',
    valueType: 'number',
    batchId: 'bant_timeline',
    instruction: 'Rate the prospect\'s timeline urgency on a scale of 0-10. 0 = no timeline, 5 = general timeframe but flexible, 10 = hard deadline confirmed.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'bant_timeline_picklist_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Timeline_Picklist__c',
    valueType: 'picklist',
    batchId: 'bant_timeline',
    instruction: 'What is the prospect\'s expected timeline? ASAP, 30 Days, 60 Days, 90+ Days, or Exploratory (no specific timeline).',
    writeMode: 'overwrite',
    options: TIMELINE_PICKLIST,
  },
  {
    id: 'bant_timeline_timestamp_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Timeline_Timestamp__c',
    valueType: 'datetime',
    batchId: 'bant_timeline',
    instruction: 'When was timeline most recently discussed?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'bant_timeline_notes_lead',
    sfObject: 'Lead',
    fieldName: 'AI_Timeline_Notes__c',
    valueType: 'textarea',
    batchId: 'bant_timeline',
    instruction: 'Additional notes about the timeline, including any events or deadlines driving urgency.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
];

const bantTimelineOpp: readonly FieldConfig[] = bantTimelineLead.map((f) => ({
  ...f,
  id: f.id.replace('_lead', '_opp'),
  sfObject: 'Opportunity' as const,
}));

// ── Planning (Opp-only) ────────────────────────────────────

const planningOpp: readonly FieldConfig[] = [
  {
    id: 'planning_recommended_next_steps_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Recommended_Next_Steps__c',
    valueType: 'textarea',
    batchId: 'planning',
    instruction: 'Based on all available context, what are the recommended next steps for the AE? Consider the deal stage, prospect needs, objections, and timeline.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'planning_recommended_plan_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Recommended_Plan__c',
    valueType: 'picklist',
    batchId: 'planning',
    instruction: 'Based on the prospect\'s portfolio size, needs, and feature requirements, which DoorLoop plan would you recommend? Starter (small portfolios, basic needs), Pro (mid-size, standard features), Premium (large portfolios, advanced features).',
    writeMode: 'overwrite',
    options: RECOMMENDED_PLAN,
  },
  {
    id: 'planning_expected_plan_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Expected_Plan__c',
    valueType: 'picklist',
    batchId: 'planning',
    instruction: 'Which plan does the prospect seem most likely to purchase based on their stated preferences, budget, and discussions? This may differ from the recommended plan.',
    writeMode: 'overwrite',
    options: RECOMMENDED_PLAN,
  },
  {
    id: 'planning_recommended_term_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Recommended_Term__c',
    valueType: 'picklist',
    batchId: 'planning',
    instruction: 'Should this prospect be offered Monthly or Annual billing? Consider their commitment level, budget preferences, and deal size.',
    writeMode: 'overwrite',
    options: RECOMMENDED_TERM,
  },
  {
    id: 'planning_expected_term_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Expected_Term__c',
    valueType: 'picklist',
    batchId: 'planning',
    instruction: 'Which billing term does the prospect seem most likely to choose based on discussions?',
    writeMode: 'overwrite',
    options: RECOMMENDED_TERM,
  },
  {
    id: 'planning_discount_discussed_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Discount_Discussed__c',
    valueType: 'picklist',
    batchId: 'planning',
    instruction: 'Was a discount discussed? If so, what level? Match to the closest option.',
    writeMode: 'overwrite',
    options: DISCOUNT_DISCUSSED,
  },
  {
    id: 'planning_expected_close_date_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Expected_Close_Date__c',
    valueType: 'date',
    batchId: 'planning',
    instruction: 'When is the deal expected to close based on all signals? Extract from explicit mentions of close dates, trial end dates, or decision timelines.',
    writeMode: 'fill_blank',
    validation: { dateFormat: 'YYYY-MM-DD' },
  },
  {
    id: 'planning_likelihood_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Likelihood_Score__c',
    valueType: 'number',
    batchId: 'planning',
    instruction: 'What is the likelihood this deal closes? Score 0-100 as a percentage. Consider all BANT scores, engagement level, competitive landscape, and deal velocity.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 100 },
  },
  {
    id: 'planning_was_ai_demoed_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Was_AI_Demoed__c',
    valueType: 'boolean',
    batchId: 'planning',
    instruction: 'Was DoorLoop\'s AI functionality specifically demoed or discussed? Look for mentions of AI Leasing, AI Maintenance, or AI features in call transcripts.',
    writeMode: 'overwrite',
  },
  {
    id: 'planning_ae_units_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_AE_Units__c',
    valueType: 'number',
    batchId: 'planning',
    instruction: 'How many units did the AE quote or discuss in pricing conversations? This may differ from the prospect\'s total managed units.',
    writeMode: 'overwrite',
    validation: { min: 0 },
  },
  {
    id: 'planning_add_on_notes_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Add_On_Notes__c',
    valueType: 'text',
    batchId: 'planning',
    instruction: 'Notes about any add-on products or services discussed (e.g., AI add-on, premium support, extra integrations). Leave blank if no add-ons discussed.',
    writeMode: 'overwrite',
    validation: { maxLength: 255 },
  },
  {
    id: 'planning_subscription_loss_reason_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Subscription_Loss_Reason__c',
    valueType: 'picklist',
    batchId: 'planning',
    instruction: 'If the deal is lost or at risk, identify the primary loss reason. Match to the closest option. Leave blank if the deal is healthy or progressing.',
    writeMode: 'overwrite',
    options: SUBSCRIPTION_LOSS_REASON,
  },
];

// ── MEDDPICC — Metrics & Economic Buyer (Opp-only) ─────────

const meddpiccMetricsBuyerOpp: readonly FieldConfig[] = [
  {
    id: 'meddpicc_metrics_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Metrics_Score__c',
    valueType: 'number',
    batchId: 'meddpicc_metrics_buyer',
    instruction: 'Rate how well defined the prospect\'s success metrics are on a scale of 0-10. 0 = no metrics discussed, 10 = specific, quantified metrics agreed upon.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'meddpicc_metrics_free_text_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Metrics_Free_Text__c',
    valueType: 'textarea',
    batchId: 'meddpicc_metrics_buyer',
    instruction: 'What metrics or KPIs has the prospect defined for success? How will they measure ROI?',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_metrics_timestamp_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Metrics_Timestamp__c',
    valueType: 'datetime',
    batchId: 'meddpicc_metrics_buyer',
    instruction: 'When were success metrics most recently discussed?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'meddpicc_metrics_notes_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Metrics_Notes__c',
    valueType: 'textarea',
    batchId: 'meddpicc_metrics_buyer',
    instruction: 'Additional notes about the prospect\'s success metrics, KPIs, and how they plan to measure value.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_economic_buyer_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Economic_Buyer_Score__c',
    valueType: 'number',
    batchId: 'meddpicc_metrics_buyer',
    instruction: 'Rate how well the economic buyer has been identified and engaged on a scale of 0-10. 0 = unknown, 5 = identified but not engaged, 10 = engaged and supportive.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'meddpicc_economic_buyer_timestamp_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Economic_Buyer_Timestamp__c',
    valueType: 'datetime',
    batchId: 'meddpicc_metrics_buyer',
    instruction: 'When was the economic buyer most recently discussed or engaged?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'meddpicc_economic_buyer_notes_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Economic_Buyer_Notes__c',
    valueType: 'textarea',
    batchId: 'meddpicc_metrics_buyer',
    instruction: 'Notes about the economic buyer: who they are, their priorities, level of engagement, and any concerns.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
];

// ── MEDDPICC — Decision Criteria & Process (Opp-only) ──────

const meddpiccDecisionOpp: readonly FieldConfig[] = [
  {
    id: 'meddpicc_decision_criteria_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Decision_Criteria_Score__c',
    valueType: 'number',
    batchId: 'meddpicc_decision',
    instruction: 'Rate how well the decision criteria are understood on a scale of 0-10. 0 = unknown, 10 = fully mapped and DoorLoop aligns well.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'meddpicc_decision_criteria_free_text_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Decision_Criteria_Free_Text__c',
    valueType: 'textarea',
    batchId: 'meddpicc_decision',
    instruction: 'What specific criteria will be used to make the buying decision? List technical, financial, and strategic criteria.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_decision_criteria_timestamp_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Decision_Criteria_Timestamp__c',
    valueType: 'datetime',
    batchId: 'meddpicc_decision',
    instruction: 'When were decision criteria most recently discussed?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'meddpicc_decision_criteria_notes_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Decision_Criteria_Notes__c',
    valueType: 'textarea',
    batchId: 'meddpicc_decision',
    instruction: 'Additional notes about decision criteria, including how DoorLoop compares on each criterion.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_decision_process_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Decision_Process_Score__c',
    valueType: 'number',
    batchId: 'meddpicc_decision',
    instruction: 'Rate how well the decision process is understood on a scale of 0-10. 0 = unknown, 10 = fully mapped with clear next steps and timeline.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'meddpicc_decision_process_free_text_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Decision_Process_Free_Text__c',
    valueType: 'textarea',
    batchId: 'meddpicc_decision',
    instruction: 'Describe the decision-making process. How many steps? Who is involved at each stage? What approvals are needed?',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_decision_process_timestamp_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Decision_Process_Timestamp__c',
    valueType: 'datetime',
    batchId: 'meddpicc_decision',
    instruction: 'When was the decision process most recently discussed?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'meddpicc_decision_process_notes_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Decision_Process_Notes__c',
    valueType: 'textarea',
    batchId: 'meddpicc_decision',
    instruction: 'Additional notes about the decision process, including any blockers or accelerators.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_decision_process_complexity_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Decision_Process_Complexity__c',
    valueType: 'picklist',
    batchId: 'meddpicc_decision',
    instruction: 'How complex is the decision process? Simple (one decision maker, fast), Standard (committee, typical timeline), Complex (multiple approval layers, legal review, long cycle).',
    writeMode: 'overwrite',
    options: DECISION_PROCESS_COMPLEXITY,
  },
];

// ── MEDDPICC — Paper Process & Identified Pain (Opp-only) ──

const meddpiccPaperPainOpp: readonly FieldConfig[] = [
  {
    id: 'meddpicc_paper_process_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Paper_Process_Score__c',
    valueType: 'number',
    batchId: 'meddpicc_paper_pain',
    instruction: 'Rate how well the paper/contract process is understood on a scale of 0-10. 0 = unknown, 10 = fully mapped with clear procurement steps.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'meddpicc_paper_process_free_text_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Paper_Process_Free_Text__c',
    valueType: 'textarea',
    batchId: 'meddpicc_paper_pain',
    instruction: 'Describe the procurement/contract process. What paperwork is needed? Legal review? Procurement department involvement?',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_paper_process_timestamp_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Paper_Process_Timestamp__c',
    valueType: 'datetime',
    batchId: 'meddpicc_paper_pain',
    instruction: 'When was the paper/procurement process most recently discussed?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'meddpicc_paper_process_notes_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Paper_Process_Notes__c',
    valueType: 'textarea',
    batchId: 'meddpicc_paper_pain',
    instruction: 'Additional notes about the paper/procurement process.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_identified_pain_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Identified_Pain_Score__c',
    valueType: 'number',
    batchId: 'meddpicc_paper_pain',
    instruction: 'Rate how well the prospect\'s pain has been identified on a scale of 0-10. 0 = no pain identified, 10 = deep pain understood with business impact quantified.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'meddpicc_identified_pain_free_text_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Identified_Pain_Free_Text__c',
    valueType: 'textarea',
    batchId: 'meddpicc_paper_pain',
    instruction: 'Describe the identified pain points in detail. What is the business impact? What is the cost of inaction?',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_identified_pain_timestamp_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Identified_Pain_Timestamp__c',
    valueType: 'datetime',
    batchId: 'meddpicc_paper_pain',
    instruction: 'When was the pain most recently discussed or validated?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'meddpicc_identified_pain_notes_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Identified_Pain_Notes__c',
    valueType: 'textarea',
    batchId: 'meddpicc_paper_pain',
    instruction: 'Additional notes about the identified pain, including any emotional or political drivers.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
];

// ── MEDDPICC — Champion & Competition (Opp-only) ───────────

const meddpiccChampionCompOpp: readonly FieldConfig[] = [
  {
    id: 'meddpicc_champion_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Champion_Score__c',
    valueType: 'number',
    batchId: 'meddpicc_champion_comp',
    instruction: 'Rate how strong the internal champion is on a scale of 0-10. 0 = no champion, 5 = supporter but limited influence, 10 = strong champion actively selling internally.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'meddpicc_champion_timestamp_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Champion_Timestamp__c',
    valueType: 'datetime',
    batchId: 'meddpicc_champion_comp',
    instruction: 'When was the champion relationship most recently engaged?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'meddpicc_champion_notes_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Champion_Notes__c',
    valueType: 'textarea',
    batchId: 'meddpicc_champion_comp',
    instruction: 'Notes about the champion: who they are, their motivation, influence level, and actions they are taking to advance the deal.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_competition_score_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Competition_Score__c',
    valueType: 'number',
    batchId: 'meddpicc_champion_comp',
    instruction: 'Rate the competitive landscape on a scale of 0-10. 0 = no competition, 5 = competitors evaluating, 10 = strong competitor with active proposal.',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10 },
  },
  {
    id: 'meddpicc_competition_timestamp_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Competition_Timestamp__c',
    valueType: 'datetime',
    batchId: 'meddpicc_champion_comp',
    instruction: 'When was competition most recently discussed?',
    writeMode: 'overwrite',
    validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' },
  },
  {
    id: 'meddpicc_competition_notes_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Competition_Notes__c',
    valueType: 'textarea',
    batchId: 'meddpicc_champion_comp',
    instruction: 'Notes about the competitive landscape: who is competing, their strengths, weaknesses, and our differentiation strategy.',
    writeMode: 'overwrite',
    validation: { maxLength: 32000 },
  },
  {
    id: 'meddpicc_competition_picklist_opp',
    sfObject: 'Opportunity',
    fieldName: 'AI_Competition_Picklist__c',
    valueType: 'multipicklist',
    batchId: 'meddpicc_champion_comp',
    instruction: 'Which competitors are actively involved in this deal? Select all that apply.',
    writeMode: 'overwrite',
    options: PM_SOFTWARE,
  },
];

// ── Assemble all field configs ──────────────────────────────

export const FIELD_CONFIGS: readonly FieldConfig[] = [
  // Firmographic (7 Lead + 7 Opp = 14)
  ...firmographicLead,
  ...firmographicOpp,
  // Discovery (5 Lead + 5 Opp = 10)
  ...discoveryLead,
  ...discoveryOpp,
  // Qualification (4 Lead + 5 Opp = 9)
  ...qualificationLead,
  ...qualificationOpp,
  // Competitive (3 Lead + 3 Opp = 6)
  ...competitiveLead,
  ...competitiveOpp,
  // BANT Budget (4 Lead + 4 Opp = 8)
  ...bantBudgetLead,
  ...bantBudgetOpp,
  // BANT Authority (4 Lead + 4 Opp = 8)
  ...bantAuthorityLead,
  ...bantAuthorityOpp,
  // BANT Need (4 Lead + 4 Opp = 8)
  ...bantNeedLead,
  ...bantNeedOpp,
  // BANT Timeline (4 Lead + 4 Opp = 8)
  ...bantTimelineLead,
  ...bantTimelineOpp,
  // Planning Opp-only (10)
  ...planningOpp,
  // MEDDPICC Metrics & Economic Buyer Opp-only (7)
  ...meddpiccMetricsBuyerOpp,
  // MEDDPICC Decision Opp-only (9)
  ...meddpiccDecisionOpp,
  // MEDDPICC Paper Process & Pain Opp-only (8)
  ...meddpiccPaperPainOpp,
  // MEDDPICC Champion & Competition Opp-only (7)
  ...meddpiccChampionCompOpp,
];

/**
 * Breakdown (audited against Brain SF metadata 2026-04-15):
 * Lead fields:  7 + 5 + 4 + 3 + 4 + 4 + 4 + 4 = 35
 * Opp fields:   7 + 5 + 5 + 3 + 4 + 4 + 4 + 4 + 12 + 7 + 9 + 8 + 7 = 79
 * Total:        35 + 79 = 114
 *
 * Planning is 12 Opp fields (was 10 + AI_Add_On_Notes__c + AI_Subscription_Loss_Reason__c).
 * The deal_strength batch is defined in batches.ts but has no field configs yet.
 */

/** Quick lookup: fieldName → FieldConfig. */
export const FIELD_CONFIG_MAP = new Map(
  FIELD_CONFIGS.map((f) => [f.id, f]),
);

/** Get all field configs for a specific batch. */
export function getFieldsByBatch(batchId: string): readonly FieldConfig[] {
  return FIELD_CONFIGS.filter((f) => f.batchId === batchId);
}

/** Get all field configs for a specific SF object. */
export function getFieldsByObject(sfObject: 'Lead' | 'Opportunity'): readonly FieldConfig[] {
  return FIELD_CONFIGS.filter((f) => f.sfObject === sfObject);
}
