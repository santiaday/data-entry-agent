/**
 * Token counting and budget enforcement.
 *
 * Uses a simple character-based approximation: ~4 chars per token.
 * This is intentionally conservative — better to under-count than over-count,
 * since exceeding the model's context window is worse than leaving some room.
 */

const CHARS_PER_TOKEN = 4;

/** Estimate the token count for a string. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate text to fit within a token budget.
 * Truncates at the nearest line break to avoid cutting mid-sentence.
 * Appends a truncation notice if the text was cut.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;

  // Find the last newline before the cutoff
  const cutoff = text.lastIndexOf('\n', maxChars);
  const truncateAt = cutoff > 0 ? cutoff : maxChars;

  return text.slice(0, truncateAt) + '\n\n[... truncated to fit token budget ...]';
}

/** Token budgets per context section. */
export const SECTION_TOKEN_BUDGETS: Record<string, number> = {
  sfObjects: 50_000,       // No practical limit — SF record fields
  recentTranscript: 15_000, // ~60k chars — most recent Gong transcript
  summaries: 8_000,         // Older transcripts compressed
  emails: 10_000,           // ~40k chars — 10 most recent
  sms: 3_000,               // ~12k chars — SMS tasks
  activities: 5_000,        // Non-SMS tasks + Events
  outreachMailings: 8_000,  // ~32k chars — cleaned mailings
};
