/**
 * Phase 1b: Parallel data fetch orchestrator.
 *
 * Fans out all 11 API calls via Promise.allSettled so that
 * individual failures don't kill the entire fetch phase.
 */

export {
  loadGongCredentials,
  loadOutreachCredentials,
  buildGongAuthHeader,
} from './credentials';

export { fetchAllData, type FetchAllParams, type FetchAllResult } from './orchestrator';
export { buildFetchInventory } from './inventory';
