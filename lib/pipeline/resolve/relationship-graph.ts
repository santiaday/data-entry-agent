/**
 * Phase 1a: Build a relationship graph from a Salesforce record ID.
 *
 * Given a Lead or Opportunity, resolves all connected records:
 *   Lead → checks conversion → gets ConvertedContactId, ConvertedAccountId, ConvertedOpportunityId
 *   Opportunity → gets AccountId, Lead_Lookup__c, OpportunityContactRoles
 *
 * The graph is used by Phase 1b (fetch) to know which IDs to query across all systems.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  executeSoql,
  type SalesforceTokenCache,
} from '@/lib/sf';
import type { SfObject } from '../types/field-config';
import type {
  RelationshipGraph,
  LeadResolutionFields,
  OppResolutionFields,
  ContactRole,
} from './types';
import { ResolveError } from '../errors';

export type ResolveParams = {
  readonly recordId: string;
  readonly objectType: SfObject;
  readonly orgId: string;
  readonly supabase: SupabaseClient;
  readonly tokenCache: SalesforceTokenCache;
};

/**
 * Build a relationship graph from the primary record.
 * Runs 1-3 SOQL queries depending on the object type and conversion status.
 */
export async function buildRelationshipGraph(
  params: ResolveParams,
): Promise<RelationshipGraph> {
  const { recordId, objectType, orgId, supabase, tokenCache } = params;

  if (objectType === 'Lead') {
    return resolveLead({ recordId, orgId, supabase, tokenCache });
  }

  return resolveOpportunity({ recordId, orgId, supabase, tokenCache });
}

// ── Lead resolution ─────────────────────────────────────────

async function resolveLead(params: {
  recordId: string;
  orgId: string;
  supabase: SupabaseClient;
  tokenCache: SalesforceTokenCache;
}): Promise<RelationshipGraph> {
  const { recordId, orgId, supabase, tokenCache } = params;

  const soql = `SELECT Id, IsConverted, ConvertedContactId, ConvertedAccountId, ConvertedOpportunityId, Outreach_Prospect_ID__c FROM Lead WHERE Id = '${escapeSoqlId(recordId)}' LIMIT 1`;

  const result = await executeSoql({ query: soql, orgId, supabase, tokenCache });

  if (result.records.length === 0) {
    throw new ResolveError(`Lead ${recordId} not found`, recordId);
  }

  const lead = result.records[0] as unknown as LeadResolutionFields;

  const contactIds: string[] = [];
  if (lead.ConvertedContactId) {
    contactIds.push(lead.ConvertedContactId);
  }

  // If the Lead was converted and has an Account, also look up ContactRoles on the Opp
  let additionalContactIds: string[] = [];
  if (lead.IsConverted && lead.ConvertedOpportunityId) {
    additionalContactIds = await fetchContactRoleIds({
      opportunityId: lead.ConvertedOpportunityId,
      orgId,
      supabase,
      tokenCache,
    });
  }

  const allContactIds = [...new Set([...contactIds, ...additionalContactIds])];

  // Try to get Outreach prospect ID from converted Contact if Lead doesn't have it
  let outreachProspectId = lead.Outreach_Prospect_ID__c;
  if (!outreachProspectId && lead.ConvertedContactId) {
    outreachProspectId = await fetchContactOutreachId({
      contactId: lead.ConvertedContactId,
      orgId,
      supabase,
      tokenCache,
    });
  }

  return {
    primaryRecord: { id: recordId, objectType: 'Lead' },
    accountId: lead.ConvertedAccountId,
    contactIds: allContactIds,
    opportunityId: lead.ConvertedOpportunityId,
    leadId: recordId,
    outreachProspectId: outreachProspectId ?? null,
    gongAccountId: lead.ConvertedAccountId,
  };
}

// ── Opportunity resolution ──────────────────────────────────

async function resolveOpportunity(params: {
  recordId: string;
  orgId: string;
  supabase: SupabaseClient;
  tokenCache: SalesforceTokenCache;
}): Promise<RelationshipGraph> {
  const { recordId, orgId, supabase, tokenCache } = params;

  // Fetch the Opp + its contact roles in parallel
  const [oppResult, contactRoleIds] = await Promise.all([
    executeSoql({
      query: `SELECT Id, AccountId, Lead_Lookup__c FROM Opportunity WHERE Id = '${escapeSoqlId(recordId)}' LIMIT 1`,
      orgId,
      supabase,
      tokenCache,
    }),
    fetchContactRoleIds({ opportunityId: recordId, orgId, supabase, tokenCache }),
  ]);

  if (oppResult.records.length === 0) {
    throw new ResolveError(`Opportunity ${recordId} not found`, recordId);
  }

  const opp = oppResult.records[0] as unknown as OppResolutionFields;

  // Resolve Lead: check Lead_Lookup__c, then fall back to Account.Original_Lead_ID__c
  let leadId = opp.Lead_Lookup__c;
  if (!leadId && opp.AccountId) {
    leadId = await fetchAccountOriginalLeadId({
      accountId: opp.AccountId,
      orgId,
      supabase,
      tokenCache,
    });
  }

  // Get Outreach prospect ID from primary contact or lead
  let outreachProspectId: string | null = null;
  if (contactRoleIds.length > 0) {
    outreachProspectId = await fetchContactOutreachId({
      contactId: contactRoleIds[0],
      orgId,
      supabase,
      tokenCache,
    });
  }
  if (!outreachProspectId && leadId) {
    outreachProspectId = await fetchLeadOutreachId({
      leadId,
      orgId,
      supabase,
      tokenCache,
    });
  }

  return {
    primaryRecord: { id: recordId, objectType: 'Opportunity' },
    accountId: opp.AccountId,
    contactIds: contactRoleIds,
    opportunityId: recordId,
    leadId,
    outreachProspectId,
    gongAccountId: opp.AccountId,
  };
}

// ── Helpers ─────────────────────────────────────────────────

async function fetchContactRoleIds(params: {
  opportunityId: string;
  orgId: string;
  supabase: SupabaseClient;
  tokenCache: SalesforceTokenCache;
}): Promise<string[]> {
  const { opportunityId, orgId, supabase, tokenCache } = params;

  try {
    const result = await executeSoql({
      query: `SELECT ContactId, IsPrimary, Role FROM OpportunityContactRole WHERE OpportunityId = '${escapeSoqlId(opportunityId)}'`,
      orgId,
      supabase,
      tokenCache,
    });

    const roles = result.records as unknown as ContactRole[];
    // Sort primary contacts first
    const sorted = [...roles].sort((a, b) => {
      if (a.IsPrimary && !b.IsPrimary) return -1;
      if (!a.IsPrimary && b.IsPrimary) return 1;
      return 0;
    });

    return sorted.map((r) => r.ContactId);
  } catch {
    // OpportunityContactRole may not exist or be inaccessible — not fatal
    return [];
  }
}

async function fetchContactOutreachId(params: {
  contactId: string;
  orgId: string;
  supabase: SupabaseClient;
  tokenCache: SalesforceTokenCache;
}): Promise<string | null> {
  try {
    const result = await executeSoql({
      query: `SELECT Outreach_Prospect_ID__c FROM Contact WHERE Id = '${escapeSoqlId(params.contactId)}' LIMIT 1`,
      orgId: params.orgId,
      supabase: params.supabase,
      tokenCache: params.tokenCache,
    });

    if (result.records.length === 0) return null;
    const val = result.records[0].Outreach_Prospect_ID__c;
    return typeof val === 'string' && val.length > 0 ? val : null;
  } catch {
    return null;
  }
}

async function fetchLeadOutreachId(params: {
  leadId: string;
  orgId: string;
  supabase: SupabaseClient;
  tokenCache: SalesforceTokenCache;
}): Promise<string | null> {
  try {
    const result = await executeSoql({
      query: `SELECT Outreach_Prospect_ID__c FROM Lead WHERE Id = '${escapeSoqlId(params.leadId)}' LIMIT 1`,
      orgId: params.orgId,
      supabase: params.supabase,
      tokenCache: params.tokenCache,
    });

    if (result.records.length === 0) return null;
    const val = result.records[0].Outreach_Prospect_ID__c;
    return typeof val === 'string' && val.length > 0 ? val : null;
  } catch {
    return null;
  }
}

async function fetchAccountOriginalLeadId(params: {
  accountId: string;
  orgId: string;
  supabase: SupabaseClient;
  tokenCache: SalesforceTokenCache;
}): Promise<string | null> {
  try {
    const result = await executeSoql({
      query: `SELECT Original_Lead_ID__c FROM Account WHERE Id = '${escapeSoqlId(params.accountId)}' LIMIT 1`,
      orgId: params.orgId,
      supabase: params.supabase,
      tokenCache: params.tokenCache,
    });

    if (result.records.length === 0) return null;
    const val = result.records[0].Original_Lead_ID__c;
    return typeof val === 'string' && val.length > 0 ? val : null;
  } catch {
    return null;
  }
}

/**
 * Escape a Salesforce ID for use in SOQL WHERE clauses.
 * Prevents SOQL injection by only allowing alphanumeric characters.
 */
function escapeSoqlId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '');
}
