/**
 * Database clients.
 *
 * This deployment uses a plain PostgreSQL database (DATABASE_URL) rather than
 * Supabase, so both clients return the local PostgREST-compatible adapter
 * (see lib/db/pg-rest.ts) cast to the Supabase client type. The two factory
 * names are kept so call sites are unchanged; there is no auth/RLS distinction
 * here — the single DB user has full access.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PgRestClient } from '@/lib/db/pg-rest';
import { createRemoteExec } from '@/lib/revops/sql-client';

/**
 * The query builder now runs every statement against the revops-agents
 * `/db/{database}/sql` endpoint as the least-privilege `data_entry_agent`
 * Postgres role — NOT a direct DB connection. The builder API is unchanged;
 * only the executor swaps (see lib/revops/sql-client.ts). Call sites keep
 * their `.from(...).select(...)` shape; table names are schema-qualified
 * (e.g. `config.field_definitions`, `runs.agent_runs`).
 */
function revopsClient(): SupabaseClient {
  return new PgRestClient(createRemoteExec() as never) as unknown as SupabaseClient;
}

export function createServiceClient(): SupabaseClient {
  return revopsClient();
}

export async function createClient(): Promise<SupabaseClient> {
  return revopsClient();
}
