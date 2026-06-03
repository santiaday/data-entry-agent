/**
 * Runs once on server boot. Applies pending database migrations before the app
 * starts serving requests. Set RUN_MIGRATIONS_ON_BOOT=false to skip (e.g. if you
 * apply migrations out of band).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.RUN_MIGRATIONS_ON_BOOT === 'false') return;
  if (!process.env.DATABASE_URL) {
    console.warn('[instrumentation] DATABASE_URL not set — skipping migrations');
    return;
  }
  try {
    const { runMigrations } = await import('@/lib/db/migrate');
    await runMigrations();
  } catch (err) {
    console.error('[instrumentation] migration failed:', err instanceof Error ? err.message : err);
  }
}
