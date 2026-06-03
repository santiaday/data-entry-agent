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
import { createPgRestClient } from '@/lib/db/pg-rest';

export function createServiceClient(): SupabaseClient {
  return createPgRestClient() as unknown as SupabaseClient;
}

export async function createClient(): Promise<SupabaseClient> {
  return createPgRestClient() as unknown as SupabaseClient;
}
