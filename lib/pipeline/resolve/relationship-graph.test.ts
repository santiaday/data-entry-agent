import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildRelationshipGraph } from './relationship-graph';
import type { ResolveParams } from './relationship-graph';

// Mock @/lib/sf's executeSoql
vi.mock('@/lib/sf', () => ({
  executeSoql: vi.fn(),
}));

import { executeSoql } from '@/lib/sf';
const mockExecuteSoql = vi.mocked(executeSoql);

const mockParams = (overrides: Partial<ResolveParams> = {}): ResolveParams => ({
  recordId: '00Q000000000001',
  objectType: 'Lead',
  orgId: '00000000-0000-0000-0000-000000000001',
  supabase: {} as never,
  tokenCache: {} as never,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildRelationshipGraph — Lead', () => {
  it('should resolve unconverted Lead with basic fields', async () => {
    mockExecuteSoql.mockResolvedValueOnce({
      totalSize: 1,
      done: true,
      records: [{
        Id: '00Q000000000001',
        IsConverted: false,
        ConvertedContactId: null,
        ConvertedAccountId: null,
        ConvertedOpportunityId: null,
        Outreach_Prospect_ID__c: 'prospect-123',
      }],
      notes: [],
    });

    const graph = await buildRelationshipGraph(mockParams());

    expect(graph.primaryRecord).toEqual({ id: '00Q000000000001', objectType: 'Lead' });
    expect(graph.leadId).toBe('00Q000000000001');
    expect(graph.accountId).toBeNull();
    expect(graph.opportunityId).toBeNull();
    expect(graph.contactIds).toEqual([]);
    expect(graph.outreachProspectId).toBe('prospect-123');
  });

  it('should resolve converted Lead with all related records', async () => {
    // First call: Lead query
    mockExecuteSoql.mockResolvedValueOnce({
      totalSize: 1,
      done: true,
      records: [{
        Id: '00Q000000000001',
        IsConverted: true,
        ConvertedContactId: '003000000000001',
        ConvertedAccountId: '001000000000001',
        ConvertedOpportunityId: '006000000000001',
        Outreach_Prospect_ID__c: null,
      }],
      notes: [],
    });

    // Second call: OpportunityContactRole query
    mockExecuteSoql.mockResolvedValueOnce({
      totalSize: 2,
      done: true,
      records: [
        { ContactId: '003000000000002', IsPrimary: false, Role: 'Influencer' },
        { ContactId: '003000000000001', IsPrimary: true, Role: 'Decision Maker' },
      ],
      notes: [],
    });

    // Third call: Contact Outreach ID lookup (converted contact has no Outreach ID on Lead)
    mockExecuteSoql.mockResolvedValueOnce({
      totalSize: 1,
      done: true,
      records: [{ Outreach_Prospect_ID__c: 'prospect-456' }],
      notes: [],
    });

    const graph = await buildRelationshipGraph(mockParams());

    expect(graph.accountId).toBe('001000000000001');
    expect(graph.opportunityId).toBe('006000000000001');
    // ConvertedContactId + OpportunityContactRoles, deduped, primary first
    expect(graph.contactIds).toContain('003000000000001');
    expect(graph.contactIds).toContain('003000000000002');
    expect(graph.outreachProspectId).toBe('prospect-456');
  });

  it('should throw ResolveError when Lead not found', async () => {
    mockExecuteSoql.mockResolvedValueOnce({
      totalSize: 0,
      done: true,
      records: [],
      notes: [],
    });

    await expect(
      buildRelationshipGraph(mockParams()),
    ).rejects.toThrow('Lead 00Q000000000001 not found');
  });
});

describe('buildRelationshipGraph — Opportunity', () => {
  it('should resolve Opportunity with Account and contacts', async () => {
    // Opp query + ContactRole query run in parallel
    mockExecuteSoql
      // First: Opportunity query
      .mockResolvedValueOnce({
        totalSize: 1,
        done: true,
        records: [{
          Id: '006000000000001',
          AccountId: '001000000000001',
          Lead_Lookup__c: '00Q000000000001',
        }],
        notes: [],
      })
      // Second: OpportunityContactRole query
      .mockResolvedValueOnce({
        totalSize: 1,
        done: true,
        records: [
          { ContactId: '003000000000001', IsPrimary: true, Role: 'Decision Maker' },
        ],
        notes: [],
      })
      // Third: Contact Outreach ID lookup
      .mockResolvedValueOnce({
        totalSize: 1,
        done: true,
        records: [{ Outreach_Prospect_ID__c: 'prospect-789' }],
        notes: [],
      });

    const graph = await buildRelationshipGraph(mockParams({
      recordId: '006000000000001',
      objectType: 'Opportunity',
    }));

    expect(graph.primaryRecord).toEqual({ id: '006000000000001', objectType: 'Opportunity' });
    expect(graph.accountId).toBe('001000000000001');
    expect(graph.opportunityId).toBe('006000000000001');
    expect(graph.leadId).toBe('00Q000000000001');
    expect(graph.contactIds).toEqual(['003000000000001']);
    expect(graph.outreachProspectId).toBe('prospect-789');
  });

  it('should fall back to Account.Original_Lead_ID__c when Lead_Lookup__c is null', async () => {
    mockExecuteSoql
      // Opportunity query
      .mockResolvedValueOnce({
        totalSize: 1,
        done: true,
        records: [{
          Id: '006000000000001',
          AccountId: '001000000000001',
          Lead_Lookup__c: null,
        }],
        notes: [],
      })
      // ContactRole query
      .mockResolvedValueOnce({
        totalSize: 0,
        done: true,
        records: [],
        notes: [],
      })
      // Account.Original_Lead_ID__c query
      .mockResolvedValueOnce({
        totalSize: 1,
        done: true,
        records: [{ Original_Lead_ID__c: '00Q000000000099' }],
        notes: [],
      })
      // Lead Outreach ID lookup (no contacts, so falls through to Lead)
      .mockResolvedValueOnce({
        totalSize: 1,
        done: true,
        records: [{ Outreach_Prospect_ID__c: 'prospect-fallback' }],
        notes: [],
      });

    const graph = await buildRelationshipGraph(mockParams({
      recordId: '006000000000001',
      objectType: 'Opportunity',
    }));

    expect(graph.leadId).toBe('00Q000000000099');
    expect(graph.outreachProspectId).toBe('prospect-fallback');
  });

  it('should throw ResolveError when Opportunity not found', async () => {
    mockExecuteSoql
      .mockResolvedValueOnce({
        totalSize: 0,
        done: true,
        records: [],
        notes: [],
      })
      .mockResolvedValueOnce({
        totalSize: 0,
        done: true,
        records: [],
        notes: [],
      });

    await expect(
      buildRelationshipGraph(mockParams({
        recordId: '006000000000001',
        objectType: 'Opportunity',
      })),
    ).rejects.toThrow('Opportunity 006000000000001 not found');
  });
});

describe('SOQL injection prevention', () => {
  it('should strip non-alphanumeric characters from record IDs', async () => {
    mockExecuteSoql.mockResolvedValueOnce({
      totalSize: 1,
      done: true,
      records: [{
        Id: '00Q000000000001',
        IsConverted: false,
        ConvertedContactId: null,
        ConvertedAccountId: null,
        ConvertedOpportunityId: null,
        Outreach_Prospect_ID__c: null,
      }],
      notes: [],
    });

    await buildRelationshipGraph(mockParams({
      recordId: "00Q000000000001'; DROP TABLE --",
    }));

    // Verify the SOQL query was sanitized — injection payload stripped to alphanumeric only
    const callArgs = mockExecuteSoql.mock.calls[0][0] as { query: string };
    // The dangerous characters ('; -- ) are stripped, leaving only alphanumeric
    expect(callArgs.query).not.toContain("';");
    expect(callArgs.query).not.toContain('--');
    expect(callArgs.query).toContain('00Q000000000001DROPTABLE');
  });
});
