/**
 * POST /api/admin/import — bulk data import.
 *
 * Lets you load data into the database from outside the deployment's network
 * (the DB itself is only reachable from inside). Auth via IMPORT_SECRET bearer
 * token; the endpoint is disabled (404) when IMPORT_SECRET is unset.
 *
 * Body: { "replace": boolean, "tables": { "de_prompts": [...], "de_runs": [...], ... } }
 * Use scripts/export-data.ts to produce the payload from a source database.
 */
import { NextResponse } from 'next/server';
import { importData, type ImportPayload } from '@/lib/db/import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.IMPORT_SECRET;
  if (!secret) {
    // Feature disabled unless explicitly enabled.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: ImportPayload;
  try {
    payload = (await request.json()) as ImportPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object' || typeof payload.tables !== 'object') {
    return NextResponse.json({ error: 'Body must be { tables: {...}, replace?: bool }' }, { status: 400 });
  }

  try {
    const result = await importData(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[admin/import]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
