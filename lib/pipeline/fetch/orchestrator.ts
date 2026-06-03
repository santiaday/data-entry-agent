/**
 * Parallel fan-out orchestrator for all data sources.
 *
 * Runs 11 API calls concurrently via Promise.allSettled:
 *   8 Salesforce SOQL queries
 *   2 Gong API calls (transcripts + extensive)
 *   1 Outreach API call (mailings)
 *
 * Each call is independent — a Gong 503 does not kill SF fetches.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SalesforceTokenCache } from '@/lib/sf';
import type { RelationshipGraph } from '../resolve/types';
import type { GongCredentials, OutreachCredentials, GongCallSfRecord } from '../types/api-responses';
import type { FetchResult } from '../types/pipeline';
import {
  fetchAccount,
  fetchContacts,
  fetchOpportunities,
  fetchLeads,
  fetchTasks,
  fetchEvents,
  fetchEmailMessages,
  fetchGongCalls,
} from './salesforce';
import { fetchGongTranscripts, fetchGongExtensive } from './gong';
import { fetchOutreachMailings } from './outreach';

export type FetchAllParams = {
  readonly graph: RelationshipGraph;
  readonly orgId: string;
  readonly supabase: SupabaseClient;
  readonly tokenCache: SalesforceTokenCache;
  readonly gongCreds: GongCredentials | null;
  readonly outreachCreds: OutreachCredentials | null;
};

export type FetchAllResult = {
  readonly account: FetchResult;
  readonly contacts: FetchResult;
  readonly opportunities: FetchResult;
  readonly leads: FetchResult;
  readonly tasks: FetchResult;
  readonly events: FetchResult;
  readonly emailMessages: FetchResult;
  readonly gongCalls: FetchResult;
  readonly gongTranscripts: FetchResult;
  readonly gongExtensive: FetchResult;
  readonly outreachMailings: FetchResult;
  readonly fetchErrors: readonly { source: string; error: string }[];
};

/**
 * Fetch all data for a record, fanning out across SF, Gong, and Outreach.
 *
 * Strategy:
 *   1. Fire all 8 SF queries + Gong calls query in parallel.
 *   2. Once Gong call IDs are known, fire Gong transcript + extensive calls.
 *   3. Fire Outreach call in parallel with everything.
 *
 * We use a two-phase approach because Gong API calls need the call IDs
 * from the SF Gong__Gong_Call__c query.
 */
export async function fetchAllData(params: FetchAllParams): Promise<FetchAllResult> {
  const { graph, orgId, supabase, tokenCache, gongCreds, outreachCreds } = params;
  const sfParams = { graph, orgId, supabase, tokenCache };

  const fetchErrors: { source: string; error: string }[] = [];

  // Phase 1: All SF queries + Outreach in parallel.
  // Uses Promise.allSettled (NOT all) so a single unexpected throw in one
  // fetcher — e.g. a raw network "fetch failed" that bypassed our wrapper's
  // try/catch — doesn't kill the entire phase. Every fetcher SHOULD return
  // {ok: false} on error, but allSettled is a belt-and-suspenders defense.
  const phase1Sources = [
    'salesforce_account',
    'salesforce_contacts',
    'salesforce_opportunities',
    'salesforce_leads',
    'salesforce_tasks',
    'salesforce_events',
    'salesforce_email_messages',
    'salesforce_gong_calls',
    'outreach_mailings',
  ] as const;

  const phase1Settled = await Promise.allSettled([
    fetchAccount(sfParams),
    fetchContacts(sfParams),
    fetchOpportunities(sfParams),
    fetchLeads(sfParams),
    fetchTasks(sfParams),
    fetchEvents(sfParams),
    fetchEmailMessages(sfParams),
    fetchGongCalls(sfParams),
    fetchOutreachData(outreachCreds, graph.outreachProspectId),
  ]);

  const phase1Results: FetchResult[] = phase1Settled.map((settled, i) => {
    if (settled.status === 'fulfilled') return settled.value;
    const reason = settled.reason;
    const error = reason instanceof Error
      ? `${reason.name}: ${reason.message}${(reason as { cause?: unknown }).cause ? ` (cause: ${String((reason as { cause?: unknown }).cause)})` : ''}`
      : String(reason);
    return { ok: false as const, error, source: phase1Sources[i] };
  });

  const [
    accountResult,
    contactsResult,
    opportunitiesResult,
    leadsResult,
    tasksResult,
    eventsResult,
    emailMessagesResult,
    gongCallsResult,
    outreachMailingsResult,
  ] = phase1Results;

  for (const r of phase1Results) {
    if (!r.ok) {
      fetchErrors.push({ source: r.source, error: r.error });
    }
  }

  // Phase 2: Gong API calls (need call IDs from SF query)
  const gongCallIds = extractGongCallIds(gongCallsResult);
  let gongTranscriptsResult: FetchResult;
  let gongExtensiveResult: FetchResult;

  if (gongCreds && gongCallIds.length > 0) {
    const gongSettled = await Promise.allSettled([
      fetchGongTranscripts(gongCreds, gongCallIds),
      fetchGongExtensive(gongCreds, gongCallIds),
    ]);
    const unwrap = (s: PromiseSettledResult<FetchResult>, source: string): FetchResult => {
      if (s.status === 'fulfilled') return s.value;
      const reason = s.reason;
      const error = reason instanceof Error
        ? `${reason.name}: ${reason.message}${(reason as { cause?: unknown }).cause ? ` (cause: ${String((reason as { cause?: unknown }).cause)})` : ''}`
        : String(reason);
      return { ok: false as const, error, source };
    };
    gongTranscriptsResult = unwrap(gongSettled[0], 'gong_transcripts');
    gongExtensiveResult = unwrap(gongSettled[1], 'gong_extensive');
  } else {
    const noDataReason = !gongCreds
      ? 'Gong credentials not configured'
      : 'No Gong calls found';

    gongTranscriptsResult = { ok: true, data: { callTranscripts: [] } };
    gongExtensiveResult = { ok: true, data: { calls: [] } };

    if (!gongCreds) {
      fetchErrors.push({ source: 'gong_transcripts', error: noDataReason });
      fetchErrors.push({ source: 'gong_extensive', error: noDataReason });
    }
  }

  if (!gongTranscriptsResult.ok) {
    fetchErrors.push({ source: gongTranscriptsResult.source, error: gongTranscriptsResult.error });
  }
  if (!gongExtensiveResult.ok) {
    fetchErrors.push({ source: gongExtensiveResult.source, error: gongExtensiveResult.error });
  }

  return {
    account: accountResult,
    contacts: contactsResult,
    opportunities: opportunitiesResult,
    leads: leadsResult,
    tasks: tasksResult,
    events: eventsResult,
    emailMessages: emailMessagesResult,
    gongCalls: gongCallsResult,
    gongTranscripts: gongTranscriptsResult,
    gongExtensive: gongExtensiveResult,
    outreachMailings: outreachMailingsResult,
    fetchErrors,
  };
}

// ── Helpers ─────────────────────────────────────────────────

async function fetchOutreachData(
  creds: OutreachCredentials | null,
  prospectId: string | null,
): Promise<FetchResult> {
  if (!creds) {
    return { ok: true, data: { data: [] } };
  }
  if (!prospectId) {
    return { ok: true, data: { data: [] } };
  }
  return fetchOutreachMailings(creds, prospectId);
}

/**
 * Extract Gong call IDs from the SF query result.
 * Defensively searches for the Gong call ID field — the exact name varies
 * by managed package version (Gong__Call_ID__c, Gong__Call_Id__c, etc.).
 */
function extractGongCallIds(gongCallsResult: FetchResult): string[] {
  if (!gongCallsResult.ok) return [];

  const records = gongCallsResult.data as readonly Record<string, unknown>[];
  if (!Array.isArray(records) || records.length === 0) return [];

  // Find the field that holds the Gong call ID.
  // Check known variants first, then fall back to pattern match.
  const knownFields = ['Gong__Call_ID__c', 'Gong__Call_Id__c', 'Gong__CallId__c'];
  const sample = records[0];
  let callIdField = knownFields.find((f) => f in sample && typeof sample[f] === 'string');

  if (!callIdField) {
    // Pattern match: any custom field containing "Call" and "Id"/"ID"
    callIdField = Object.keys(sample).find((k) => {
      if (!k.endsWith('__c')) return false;
      const lower = k.toLowerCase();
      return lower.includes('call') && (lower.includes('_id') || lower.endsWith('id__c'));
    });
  }

  if (!callIdField) return [];

  return records
    .map((r) => r[callIdField!])
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
