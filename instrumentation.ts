/**
 * Next.js instrumentation hook — runs once on server boot.
 *
 * Revops-backed mode: the schema lives in revops-agents (its migrations own
 * config.* / runs.*), and this UI reaches it through the remote SQL endpoint —
 * it does not own or migrate the database. There are no boot-time migrations
 * to run here, so this is intentionally a no-op.
 */
export async function register() {
  // Intentionally empty — no boot-time work in the thin control-panel model.
}
