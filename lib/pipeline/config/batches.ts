/**
 * Batch definitions for the 14 extraction groups.
 * Each batch groups related fields and defines which context sections
 * are relevant for extraction.
 */

import type { BatchConfig } from '../types/field-config';

export const BATCH_CONFIGS: readonly BatchConfig[] = [
  {
    batchId: 'firmographic',
    label: 'Firmographic',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries'],
    maxTokens: 8000,
  },
  {
    batchId: 'discovery',
    label: 'Discovery',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails', 'outreachMailings'],
    maxTokens: 12000,
  },
  {
    batchId: 'qualification',
    label: 'Qualification',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails'],
    maxTokens: 10000,
  },
  {
    batchId: 'competitive',
    label: 'Competitive Intelligence',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails', 'outreachMailings'],
    maxTokens: 10000,
  },
  {
    batchId: 'bant_budget',
    label: 'BANT — Budget',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails'],
    maxTokens: 8000,
  },
  {
    batchId: 'bant_authority',
    label: 'BANT — Authority',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails'],
    maxTokens: 8000,
  },
  {
    batchId: 'bant_need',
    label: 'BANT — Need',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails'],
    maxTokens: 8000,
  },
  {
    batchId: 'bant_timeline',
    label: 'BANT — Timeline',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails'],
    maxTokens: 8000,
  },
  {
    batchId: 'planning',
    label: 'Planning',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails', 'activities'],
    maxTokens: 10000,
  },
  {
    batchId: 'meddpicc_metrics_buyer',
    label: 'MEDDPICC — Metrics & Economic Buyer',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails'],
    maxTokens: 10000,
  },
  {
    batchId: 'meddpicc_decision',
    label: 'MEDDPICC — Decision Criteria & Process',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails'],
    maxTokens: 10000,
  },
  {
    batchId: 'meddpicc_paper_pain',
    label: 'MEDDPICC — Paper Process & Identified Pain',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails'],
    maxTokens: 10000,
  },
  {
    batchId: 'meddpicc_champion_comp',
    label: 'MEDDPICC — Champion & Competition',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails'],
    maxTokens: 10000,
  },
  {
    batchId: 'deal_strength',
    label: 'Deal Strength',
    contextSections: ['sfObjects', 'recentTranscript', 'summaries', 'emails', 'activities'],
    maxTokens: 10000,
  },
] as const;

/** Quick lookup map: batchId → BatchConfig. */
export const BATCH_CONFIG_MAP: ReadonlyMap<string, BatchConfig> = new Map(
  BATCH_CONFIGS.map((b) => [b.batchId as string, b]),
);
