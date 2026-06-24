/**
 * Shared types + formatting helpers for the Analytics page sub-components.
 * The shapes mirror the GET /api/data-entry/analytics response exactly.
 */

export type Attention =
  | 'never_extracted'
  | 'high_error'
  | 'low_populate'
  | 'low_confidence'
  | 'ok';

export type FieldHealth = {
  sfObject: string;
  fieldApiName: string;
  valueType: string | null;
  writeMode: string | null;
  groupKey: string | null;
  configured: boolean;
  attempts: number;
  populated: number;
  populateRate: number;
  written: number;
  wouldWrite: number;
  writeRate: number;
  errored: number;
  errorRate: number;
  lowConfSkips: number;
  avgConfidence: number;
  dominantSkipReason: string | null;
  lastValue: string | null;
  lastValueAt: string | null;
  lastSeenAt: string | null;
  attention: Attention;
};

export type ErrorFamily = {
  family: string;
  label: string;
  kind: 'config' | 'data' | 'system' | 'quality';
  count: number;
  pct: number;
};

export type OutcomeBucket = { outcome: string; count: number; pct: number };
export type SkipReasonBucket = { reason: string; count: number; pct: number };
export type LeaderboardEntry = {
  sfObject: string;
  fieldApiName: string;
  errors: number;
  sfRejected: number;
  fls: number;
  writeFailed: number;
  invalid: number;
};
export type ValidationMessage = { message: string; count: number };
export type ErrorTrendPoint = { day: string; errors: number; attempts: number };

export type ErrorAnalytics = {
  byFamily: ErrorFamily[];
  outcomeDistribution: OutcomeBucket[];
  skipReasonDistribution: SkipReasonBucket[];
  fieldLeaderboard: LeaderboardEntry[];
  validationMessages: ValidationMessage[];
  trend: ErrorTrendPoint[];
};

export type StatusCount = { status: string; count: number };
export type FailureReason = { reason: string; count: number };
export type RunTrendPoint = {
  day: string;
  runs: number;
  completed: number;
  failed: number;
  dryRun: number;
  live: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};
export type StuckRun = {
  runId: string;
  subjectId: string | null;
  subjectKind: string | null;
  status: string;
  startedAt: string;
  ageSeconds: number;
};
export type RunSummary = {
  total: number;
  completed: number;
  failed: number;
  failureRate: number;
  avgDurationMs: number | null;
  dryRunPct: number;
  stuckCount: number;
};

export type RunHealthData = {
  statusMix: StatusCount[];
  failureReasons: FailureReason[];
  trend: RunTrendPoint[];
  stuck: StuckRun[];
  summary: RunSummary;
};

export type Kpis = {
  attempts: number;
  distinctFields: number;
  populated: number;
  populateRate: number;
  written: number;
  wouldWrite: number;
  writeRate: number;
  errored: number;
  errorRate: number;
  fieldsNeedingAttention: number;
  runFailureRate: number;
  stuckRuns: number;
};

export type Analytics = {
  period: { days: number; since: string; objectType: string };
  kpis: Kpis;
  fieldHealth: FieldHealth[];
  errors: ErrorAnalytics;
  runs: RunHealthData;
};

// ── Formatting helpers ──

export const pct = (n: number, dp = 1): string => `${(n * 100).toFixed(dp)}%`;

export const num = (n: number): string => n.toLocaleString();

/** ms → compact "Xh Ym" / "Ym Zs" / "Zs". */
export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Seconds → compact relative age, e.g. "15h 0m". */
export function formatAge(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** ISO timestamp → short relative-ish label ("3h ago", "2d ago", or a date). */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

// ── Color systems shared across sections ──

/** Populate/write bar color by rate: red <50%, amber <80%, green ≥80%. */
export function barColor(r: number): string {
  if (r < 0.5) return 'bg-red-500';
  if (r < 0.8) return 'bg-amber-500';
  return 'bg-emerald-500';
}

/** Confidence dot color: green ≥0.9, amber ≥0.7, red below (grey when unknown). */
export function confidenceDot(c: number): string {
  if (c <= 0) return 'bg-gray-300';
  if (c >= 0.9) return 'bg-emerald-500';
  if (c >= 0.7) return 'bg-amber-500';
  return 'bg-red-500';
}

export const ATTENTION_META: Record<Attention, { label: string; className: string }> = {
  high_error: { label: 'High error', className: 'bg-red-100 text-red-800 border-red-200' },
  low_populate: { label: 'Low populate', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  low_confidence: { label: 'Low confidence', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  never_extracted: { label: 'Never extracted', className: 'bg-gray-100 text-gray-700 border-gray-200' },
  ok: { label: 'OK', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

export const ERROR_KIND_META: Record<
  ErrorFamily['kind'],
  { label: string; className: string }
> = {
  config: { label: 'Config', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  data: { label: 'Data', className: 'bg-red-100 text-red-800 border-red-200' },
  system: { label: 'System', className: 'bg-purple-100 text-purple-800 border-purple-200' },
  quality: { label: 'Quality', className: 'bg-gray-100 text-gray-700 border-gray-200' },
};

/** One-line remediation guidance per error family (reused from the run UI copy). */
export const ERROR_FAMILY_ACTIONS: Record<string, string> = {
  fls: 'Grant the integration user Edit field-level security on these fields (SF Setup → Permission Sets / Profiles → Field-Level Security). Config problem, not a data problem.',
  sf_rejected: 'SF rejected the value — usually a record-type picklist restriction or validation rule. Check Object Manager → Record Types → Picklists Available for Editing.',
  invalid: 'The value failed local validation (bad picklist option, date format, range). Reconcile the field instruction + seeded picklist options at /data-entry/fields.',
  write_failed: 'The whole PATCH failed (auth, 500, missing recordId). Check the run error column for the specific SF error.',
  low_confidence: 'The LLM produced a value below the confidence threshold and skipped it. Tighten the extraction instruction or lower the threshold if the values look right.',
};

/** Status → stacked-bar segment color for Run Health. */
export function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-red-500';
    case 'cancelled':
      return 'bg-gray-400';
    case 'running':
    case 'pending':
    case 'sleeping':
    case 'awaiting_transcript':
    case 'awaiting_settle':
      return 'bg-amber-500';
    default:
      return 'bg-blue-400';
  }
}
