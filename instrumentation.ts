/**
 * Runs once on server boot. Applies pending database migrations before the app
 * starts serving requests. Set RUN_MIGRATIONS_ON_BOOT=false to skip.
 *
 * The migration code (and `pg`) is imported only inside the nodejs-runtime
 * branch so it is never bundled into the Edge middleware runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.RUN_MIGRATIONS_ON_BOOT === 'false') return;
    // Revops-backed mode: the schema lives in revops-agents (its migrations
    // own config.* / runs.*), and the UI reaches it through the SQL endpoint —
    // it does not own or migrate the database. Never run boot migrations here.
    if (process.env.REVOPS_SQL_ENDPOINT) return;
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
}
