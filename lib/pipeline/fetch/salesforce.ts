/**
 * Salesforce data fetchers for Phase 1b.
 *
 * 8 SOQL queries run in parallel via the orchestrator:
 *   1. Account (FIELDS(ALL))
 *   2. Contacts (FIELDS(ALL))
 *   3. Opportunities (FIELDS(ALL))
 *   4. Leads (FIELDS(ALL))
 *   5. Tasks (filtered by WhoId/WhatId)
 *   6. Events (filtered by WhoId/WhatId)
 *   7. EmailMessages (filtered by RelatedToId)
 *   8. Gong Call objects (Gong__Gong_Call__c)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { executeSoql, type SalesforceTokenCache } from '@/lib/sf';
import type { RelationshipGraph } from '../resolve/types';
import type { FetchResult } from '../types/pipeline';
import { FetchError } from '../errors';

type SfFetchParams = {
  readonly graph: RelationshipGraph;
  readonly orgId: string;
  readonly supabase: SupabaseClient;
  readonly tokenCache: SalesforceTokenCache;
};

function escapeSoqlId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '');
}

function escapeSoqlIds(ids: readonly string[]): string {
  return ids.map((id) => `'${escapeSoqlId(id)}'`).join(',');
}

async function safeQuery(
  source: string,
  params: { query: string; orgId: string; supabase: SupabaseClient; tokenCache: SalesforceTokenCache },
): Promise<FetchResult> {
  try {
    const result = await executeSoql(params);
    return { ok: true, data: result.records };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, source };
  }
}

// ── Individual fetchers ─────────────────────────────────────

export async function fetchAccount(params: SfFetchParams): Promise<FetchResult> {
  if (!params.graph.accountId) {
    return { ok: true, data: [] };
  }
  return safeQuery('salesforce_account', {
    query: `SELECT FIELDS(ALL) FROM Account WHERE Id = '${escapeSoqlId(params.graph.accountId)}' LIMIT 1`,
    orgId: params.orgId,
    supabase: params.supabase,
    tokenCache: params.tokenCache,
  });
}

export async function fetchContacts(params: SfFetchParams): Promise<FetchResult> {
  if (params.graph.contactIds.length === 0) {
    return { ok: true, data: [] };
  }
  return safeQuery('salesforce_contacts', {
    query: `SELECT FIELDS(ALL) FROM Contact WHERE Id IN (${escapeSoqlIds(params.graph.contactIds)}) LIMIT 200`,
    orgId: params.orgId,
    supabase: params.supabase,
    tokenCache: params.tokenCache,
  });
}

export async function fetchOpportunities(params: SfFetchParams): Promise<FetchResult> {
  if (!params.graph.opportunityId && !params.graph.accountId) {
    return { ok: true, data: [] };
  }
  // If we have a specific Opp, fetch it; otherwise fetch all Opps for the Account
  const whereClause = params.graph.opportunityId
    ? `Id = '${escapeSoqlId(params.graph.opportunityId)}'`
    : `AccountId = '${escapeSoqlId(params.graph.accountId!)}'`;

  return safeQuery('salesforce_opportunities', {
    query: `SELECT FIELDS(ALL) FROM Opportunity WHERE ${whereClause} LIMIT 200`,
    orgId: params.orgId,
    supabase: params.supabase,
    tokenCache: params.tokenCache,
  });
}

export async function fetchLeads(params: SfFetchParams): Promise<FetchResult> {
  if (!params.graph.leadId) {
    return { ok: true, data: [] };
  }
  return safeQuery('salesforce_leads', {
    query: `SELECT FIELDS(ALL) FROM Lead WHERE Id = '${escapeSoqlId(params.graph.leadId)}' LIMIT 1`,
    orgId: params.orgId,
    supabase: params.supabase,
    tokenCache: params.tokenCache,
  });
}

export async function fetchTasks(params: SfFetchParams): Promise<FetchResult> {
  return fetchActivities('Task', 'salesforce_tasks', params);
}

export async function fetchEvents(params: SfFetchParams): Promise<FetchResult> {
  return fetchActivities('Event', 'salesforce_events', params);
}

/**
 * Fetch Task or Event records directly with FIELDS(STANDARD), filtering in
 * parallel by both WhoId (Lead + Contacts) and WhatId (Account + Opportunity).
 *
 * Trade-offs with this approach (vs parent-relationship subqueries):
 *   + FIELDS(STANDARD) automatically respects the API user's FLS — fields they
 *     can't read are silently excluded, so no brittle "No such column" errors
 *     on Description when FLS varies.
 *   - If the API user lacks access to WhoId on Task/Event, activities linked
 *     ONLY via WhoId (e.g. SMS tasks on Leads with WhatId=null) are missed.
 *     The fix is field-level: grant WhoId read access to the integration user.
 *
 * The two sub-queries run in parallel; an error on one doesn't lose the other.
 */
async function fetchActivities(
  object: 'Task' | 'Event',
  source: string,
  params: SfFetchParams,
): Promise<FetchResult> {
  const whoIds = buildWhoIds(params.graph);
  const whatIds = buildWhatIds(params.graph);

  if (whoIds.length === 0 && whatIds.length === 0) {
    return { ok: true, data: [] };
  }

  const [byWho, byWhat] = await Promise.all([
    whoIds.length > 0
      ? safeQuery(`${source}_by_who`, {
          query: `SELECT FIELDS(STANDARD) FROM ${object} WHERE WhoId IN (${escapeSoqlIds(whoIds)}) ORDER BY CreatedDate DESC LIMIT 200`,
          orgId: params.orgId,
          supabase: params.supabase,
          tokenCache: params.tokenCache,
        })
      : Promise.resolve<FetchResult>({ ok: true, data: [] }),
    whatIds.length > 0
      ? safeQuery(`${source}_by_what`, {
          query: `SELECT FIELDS(STANDARD) FROM ${object} WHERE WhatId IN (${escapeSoqlIds(whatIds)}) ORDER BY CreatedDate DESC LIMIT 200`,
          orgId: params.orgId,
          supabase: params.supabase,
          tokenCache: params.tokenCache,
        })
      : Promise.resolve<FetchResult>({ ok: true, data: [] }),
  ]);

  const whoRecords = byWho.ok ? (byWho.data as readonly Record<string, unknown>[]) : [];
  const whatRecords = byWhat.ok ? (byWhat.data as readonly Record<string, unknown>[]) : [];

  // If BOTH sub-queries failed (likely a structural issue like WhoId + WhatId
  // both restricted), surface one of the errors so the user sees why.
  if (!byWho.ok && !byWhat.ok) {
    return byWhat;
  }

  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const r of [...whoRecords, ...whatRecords]) {
    const id = r.Id as string | undefined;
    if (id && !seen.has(id)) {
      seen.add(id);
      merged.push(r);
    }
  }

  return { ok: true, data: merged };
}

// ── Helpers ─────────────────────────────────────────────────

/** Build the list of WhoId targets (Lead, Contacts). */
function buildWhoIds(graph: RelationshipGraph): string[] {
  const ids: string[] = [];
  if (graph.leadId) ids.push(graph.leadId);
  ids.push(...graph.contactIds);
  return ids;
}

/** Build the list of WhatId targets (Account, Opportunity). */
function buildWhatIds(graph: RelationshipGraph): string[] {
  const ids: string[] = [];
  if (graph.accountId) ids.push(graph.accountId);
  if (graph.opportunityId) ids.push(graph.opportunityId);
  return ids;
}

export async function fetchEmailMessages(params: SfFetchParams): Promise<FetchResult> {
  // EmailMessage uses RelatedToId (typically Account or Opportunity)
  const relatedToIds: string[] = [];
  if (params.graph.accountId) relatedToIds.push(params.graph.accountId);
  if (params.graph.opportunityId) relatedToIds.push(params.graph.opportunityId);

  if (relatedToIds.length === 0) {
    return { ok: true, data: [] };
  }

  return safeQuery('salesforce_email_messages', {
    query: `SELECT Id, Subject, TextBody, FromAddress, ToAddress, MessageDate, Incoming, RelatedToId, CreatedDate FROM EmailMessage WHERE RelatedToId IN (${escapeSoqlIds(relatedToIds)}) ORDER BY MessageDate DESC LIMIT 50`,
    orgId: params.orgId,
    supabase: params.supabase,
    tokenCache: params.tokenCache,
  });
}

export async function fetchGongCalls(params: SfFetchParams): Promise<FetchResult> {
  if (!params.graph.accountId && !params.graph.opportunityId) {
    return { ok: true, data: [] };
  }

  // Step 1: Peek at the schema to discover the Account/Opportunity reference
  // field names. The Gong managed package uses different field names across
  // versions (Gong__Account__c, Account__c, Gong__Primary_Account__c, etc.).
  const peek = await safeQuery('salesforce_gong_calls_peek', {
    query: `SELECT FIELDS(ALL) FROM Gong__Gong_Call__c ORDER BY CreatedDate DESC LIMIT 1`,
    orgId: params.orgId,
    supabase: params.supabase,
    tokenCache: params.tokenCache,
  });

  if (!peek.ok) {
    // Object doesn't exist, or permissions issue — surface the error.
    return { ok: false, error: peek.error, source: 'salesforce_gong_calls' };
  }

  const peekRecords = peek.data as readonly Record<string, unknown>[];
  if (peekRecords.length === 0) {
    return { ok: true, data: [] };
  }

  const sample = peekRecords[0];
  const allFields = Object.keys(sample);

  // Find any custom field whose name contains "Account" or "Opportunity".
  const accountField = allFields.find((f) => f.endsWith('__c') && /account/i.test(f));
  const opportunityField = allFields.find((f) => f.endsWith('__c') && /opportunity/i.test(f));

  const filters: string[] = [];
  if (params.graph.accountId && accountField) {
    filters.push(`${accountField} = '${escapeSoqlId(params.graph.accountId)}'`);
  }
  if (params.graph.opportunityId && opportunityField) {
    filters.push(`${opportunityField} = '${escapeSoqlId(params.graph.opportunityId)}'`);
  }

  if (filters.length === 0) {
    // Schema doesn't have a recognizable Account/Opportunity reference —
    // fall back to returning the peek record so downstream still has something.
    return { ok: true, data: [] };
  }

  return safeQuery('salesforce_gong_calls', {
    query: `SELECT FIELDS(ALL) FROM Gong__Gong_Call__c WHERE (${filters.join(' OR ')}) ORDER BY CreatedDate DESC LIMIT 50`,
    orgId: params.orgId,
    supabase: params.supabase,
    tokenCache: params.tokenCache,
  });
}

