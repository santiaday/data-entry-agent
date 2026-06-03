/**
 * Phase 2: Context compiler.
 *
 * Takes all fetch results and assembles them into structured context sections
 * with token budgets. Missing data sources get placeholder text so the LLM
 * knows not to hallucinate that information.
 */

import type { FetchAllResult } from '../fetch/orchestrator';
import type { GongTranscriptResponse, GongExtensiveResponse } from '../types/api-responses';
import type { CompiledContext, CompiledSection } from '../types/pipeline';
import { estimateTokens } from './token-budget';
import {
  buildSfObjectsSection,
  buildRecentTranscriptSection,
  buildSummariesSection,
  buildEmailsSection,
  buildSmsSection,
  buildActivitiesSection,
  buildOutreachMailingsSection,
} from './section-builders';

/**
 * Compile all context sections from fetch results.
 *
 * Each section is built independently and truncated to its token budget.
 * The resulting CompiledContext maps section keys to their content + token counts.
 */
export function compileContext(fetchResults: FetchAllResult): CompiledContext {
  const sections = new Map<string, CompiledSection>();

  // SF Objects (all record fields)
  const sfObjects = buildSfObjectsSection(
    fetchResults.account,
    fetchResults.contacts,
    fetchResults.opportunities,
    fetchResults.leads,
  );
  sections.set('sfObjects', {
    key: 'sfObjects',
    content: sfObjects,
    tokenCount: estimateTokens(sfObjects),
  });

  // Recent Transcript (most recent Gong call, full text)
  const recentTranscript = buildRecentTranscriptSection(
    fetchResults.gongTranscripts as typeof fetchResults.gongTranscripts & { data: GongTranscriptResponse },
    fetchResults.gongExtensive as typeof fetchResults.gongExtensive & { data: GongExtensiveResponse },
  );
  sections.set('recentTranscript', {
    key: 'recentTranscript',
    content: recentTranscript,
    tokenCount: estimateTokens(recentTranscript),
  });

  // Summaries (older transcripts compressed)
  const summaries = buildSummariesSection(
    fetchResults.gongTranscripts as typeof fetchResults.gongTranscripts & { data: GongTranscriptResponse },
    fetchResults.gongExtensive as typeof fetchResults.gongExtensive & { data: GongExtensiveResponse },
  );
  sections.set('summaries', {
    key: 'summaries',
    content: summaries,
    tokenCount: estimateTokens(summaries),
  });

  // Emails (10 most recent)
  const emails = buildEmailsSection(fetchResults.emailMessages);
  sections.set('emails', {
    key: 'emails',
    content: emails,
    tokenCount: estimateTokens(emails),
  });

  // SMS
  const sms = buildSmsSection(fetchResults.tasks);
  sections.set('sms', {
    key: 'sms',
    content: sms,
    tokenCount: estimateTokens(sms),
  });

  // Activities (non-SMS tasks + events)
  const activities = buildActivitiesSection(fetchResults.tasks, fetchResults.events);
  sections.set('activities', {
    key: 'activities',
    content: activities,
    tokenCount: estimateTokens(activities),
  });

  // Outreach Mailings
  const outreachMailings = buildOutreachMailingsSection(fetchResults.outreachMailings);
  sections.set('outreachMailings', {
    key: 'outreachMailings',
    content: outreachMailings,
    tokenCount: estimateTokens(outreachMailings),
  });

  let totalTokens = 0;
  for (const section of sections.values()) {
    totalTokens += section.tokenCount;
  }

  return { sections, totalTokens };
}

/**
 * Select context sections relevant to a specific batch.
 * Returns the concatenated content of the requested sections.
 */
export function selectContextForBatch(
  context: CompiledContext,
  sectionKeys: readonly string[],
): string {
  const parts: string[] = [];

  for (const key of sectionKeys) {
    const section = context.sections.get(key);
    if (section) {
      parts.push(section.content);
    }
  }

  return parts.join('\n\n---\n\n');
}

/** Canonical order of sections in a full-context prompt. */
const FULL_CONTEXT_ORDER: readonly string[] = [
  'sfObjects',
  'recentTranscript',
  'summaries',
  'emails',
  'outreachMailings',
  'sms',
  'activities',
];

/**
 * Select ALL context sections in a canonical order, each labeled.
 * Used by single-call extraction so the LLM sees every piece of evidence
 * at once and cites whichever is most specific.
 */
export function selectAllContext(context: CompiledContext): string {
  const parts: string[] = [];

  for (const key of FULL_CONTEXT_ORDER) {
    const section = context.sections.get(key);
    if (section && section.content.trim().length > 0) {
      parts.push(`# ${toHeading(key)}\n\n${section.content}`);
    }
  }

  return parts.join('\n\n---\n\n');
}

function toHeading(key: string): string {
  switch (key) {
    case 'sfObjects':          return 'Salesforce Record Data';
    case 'recentTranscript':   return 'Most Recent Call Transcript';
    case 'summaries':          return 'Older Call Summaries';
    case 'emails':             return 'Email Messages';
    case 'outreachMailings':   return 'Outreach Mailings';
    case 'sms':                return 'SMS Messages';
    case 'activities':         return 'Tasks & Events';
    default:                   return key;
  }
}
