/**
 * Build a human-readable inventory of what the fetch phase actually retrieved.
 *
 * Each item reports the source name, a status flag (ok/empty/error), the
 * count of records/items found, and any error message. The UI displays this
 * as a "Context Found" panel on the run detail page so users can see at a
 * glance whether each source contributed data — especially useful when
 * diagnosing "why did the agent miss X for this record" questions.
 */

import type { FetchAllResult } from './orchestrator';
import type { FetchResult, FetchInventoryItem } from '../types/pipeline';
import type {
  GongTranscriptResponse,
  GongExtensiveResponse,
  OutreachMailingResponse,
} from '../types/api-responses';

type InventoryBuilder = (r: FetchResult) => { status: 'ok' | 'empty' | 'error'; count: number; error?: string };

/** SF queries return an array of records directly. */
const sfInventory: InventoryBuilder = (r) => {
  if (!r.ok) return { status: 'error', count: 0, error: r.error };
  const records = r.data as readonly unknown[] | undefined;
  const count = Array.isArray(records) ? records.length : 0;
  return { status: count > 0 ? 'ok' : 'empty', count };
};

/** Gong transcripts response: { callTranscripts: [...] }. */
const gongTranscriptInventory: InventoryBuilder = (r) => {
  if (!r.ok) return { status: 'error', count: 0, error: r.error };
  const data = r.data as GongTranscriptResponse | undefined;
  const count = data?.callTranscripts?.length ?? 0;
  return { status: count > 0 ? 'ok' : 'empty', count };
};

/** Gong extensive response: { calls: [...] }. */
const gongExtensiveInventory: InventoryBuilder = (r) => {
  if (!r.ok) return { status: 'error', count: 0, error: r.error };
  const data = r.data as GongExtensiveResponse | undefined;
  const count = data?.calls?.length ?? 0;
  return { status: count > 0 ? 'ok' : 'empty', count };
};

/** Outreach mailings response: { data: [...] }. */
const outreachInventory: InventoryBuilder = (r) => {
  if (!r.ok) return { status: 'error', count: 0, error: r.error };
  const data = r.data as OutreachMailingResponse | undefined;
  const count = data?.data?.length ?? 0;
  return { status: count > 0 ? 'ok' : 'empty', count };
};

/**
 * Build the inventory array in a stable display order.
 */
export function buildFetchInventory(results: FetchAllResult): FetchInventoryItem[] {
  // Labels are the human-readable source names shown in the UI.
  // Keep the order stable for consistent rendering across runs.
  const items: Array<{ source: string; builder: InventoryBuilder; result: FetchResult }> = [
    { source: 'Salesforce Account',       builder: sfInventory,              result: results.account },
    { source: 'Salesforce Contacts',      builder: sfInventory,              result: results.contacts },
    { source: 'Salesforce Opportunities', builder: sfInventory,              result: results.opportunities },
    { source: 'Salesforce Leads',         builder: sfInventory,              result: results.leads },
    { source: 'Salesforce Tasks',         builder: sfInventory,              result: results.tasks },
    { source: 'Salesforce Events',        builder: sfInventory,              result: results.events },
    { source: 'Salesforce Emails',        builder: sfInventory,              result: results.emailMessages },
    { source: 'Salesforce Gong Calls',    builder: sfInventory,              result: results.gongCalls },
    { source: 'Gong Transcripts',         builder: gongTranscriptInventory,  result: results.gongTranscripts },
    { source: 'Gong Extensive',           builder: gongExtensiveInventory,   result: results.gongExtensive },
    { source: 'Outreach Mailings',        builder: outreachInventory,        result: results.outreachMailings },
  ];

  return items.map(({ source, builder, result }) => {
    const built = builder(result);
    return { source, ...built };
  });
}
