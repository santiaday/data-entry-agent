import { config } from 'dotenv';
import * as path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPgRestClient } from '@/lib/db/pg-rest';

// Used by the backfill / OAuth CLIs (scripts/*). Loads env from the repo root:
// .env.local first, then .env as a fallback.
const cwd = process.cwd();
config({ path: path.join(cwd, '.env.local') });
config({ path: path.join(cwd, '.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL in .env.local / .env');
}

export const supabase = createPgRestClient() as unknown as SupabaseClient;
export const ORG_ID = '00000000-0000-0000-0000-000000000001';
