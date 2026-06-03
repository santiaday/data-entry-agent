/**
 * Types for the relationship graph resolver.
 */

import type { SfObject } from '../types/field-config';

/** A resolved relationship graph for a single record. */
export type RelationshipGraph = {
  /** The primary record that triggered the run. */
  readonly primaryRecord: {
    readonly id: string;
    readonly objectType: SfObject;
  };
  /** Resolved Account ID (from Lead conversion or Opp's AccountId). */
  readonly accountId: string | null;
  /** All related Contact IDs. */
  readonly contactIds: readonly string[];
  /** Resolved Opportunity ID (from Lead conversion or the primary record). */
  readonly opportunityId: string | null;
  /** Resolved Lead ID (the primary record or looked up from Opp). */
  readonly leadId: string | null;
  /** Outreach Prospect ID for mailings lookup (from Lead or primary Contact). */
  readonly outreachProspectId: string | null;
  /** Gong Account ID (for filtering Gong calls). */
  readonly gongAccountId: string | null;
};

/** Raw Lead fields needed for relationship resolution. */
export type LeadResolutionFields = {
  readonly Id: string;
  readonly IsConverted: boolean;
  readonly ConvertedContactId: string | null;
  readonly ConvertedAccountId: string | null;
  readonly ConvertedOpportunityId: string | null;
  readonly Outreach_Prospect_ID__c: string | null;
};

/** Raw Opportunity fields needed for relationship resolution. */
export type OppResolutionFields = {
  readonly Id: string;
  readonly AccountId: string | null;
  readonly Lead_Lookup__c: string | null;
};

/** An OpportunityContactRole record. */
export type ContactRole = {
  readonly Id: string;
  readonly ContactId: string;
  readonly Role: string | null;
  readonly IsPrimary: boolean;
};
