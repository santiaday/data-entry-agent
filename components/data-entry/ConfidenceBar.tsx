'use client';

export function ConfidenceBar({ confidence }: { confidence: number | null }) {
  if (confidence === null) return <span className="text-xs text-muted-foreground">--</span>;

  const pct = Math.round(confidence * 100);
  const color = confidence >= 0.9
    ? 'bg-green-500'
    : confidence >= 0.7
      ? 'bg-yellow-500'
      : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-gray-200">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}
