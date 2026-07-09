/**
 * V1: Single-org mode. When auth is added, this will be replaced
 * by the authenticated user's org_id from the session.
 */
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

/** DoorLoop's Salesforce org — static, not per-environment (single prod org). */
const SF_LIGHTNING_BASE = 'https://doorloop.lightning.force.com/lightning/r';

export function salesforceRecordUrl(sfObject: string, recordId: string): string {
  return `${SF_LIGHTNING_BASE}/${sfObject}/${recordId}/view`;
}
