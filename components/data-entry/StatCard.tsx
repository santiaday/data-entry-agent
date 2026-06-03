export function StatCard({ label, value, className }: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border bg-card p-4 transition hover:shadow-sm ${className ?? ''}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
