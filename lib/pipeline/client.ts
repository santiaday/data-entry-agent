import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as path from 'node:path';

// Used only by the backfill CLI (scripts/backfill.ts / `pnpm backfill`).
// Loads env from the repo root: .env.local first, then .env as a fallback.
const cwd = process.cwd();
config({ path: path.join(cwd, '.env.local') });
config({ path: path.join(cwd, '.env') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  );
}

export const supabase: SupabaseClient = createClient(url, key);
export const ORG_ID = '00000000-0000-0000-0000-000000000001';
