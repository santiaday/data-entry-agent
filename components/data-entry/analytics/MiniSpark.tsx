'use client';

import { useId } from 'react';

/**
 * MiniSpark — a tiny inline SVG sparkline (line + soft area fill) for trend
 * arrays. Self-contained (no external chart lib); scales to the data's own
 * min/max with a flat baseline when the series is constant.
 */
export function MiniSpark({
  values,
  width = 120,
  height = 32,
  className,
  colorClass = 'text-emerald-500',
  title,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  colorClass?: string;
  title?: string;
}) {
  const gradientId = useId();

  if (values.length === 0) {
    return <div className={className} style={{ width, height }} aria-hidden />;
  }

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = values.map((v, i) => {
    const x = values.length === 1 ? pad + innerW / 2 : pad + (i / (values.length - 1)) * innerW;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return { x, y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath =
    `M${points[0].x.toFixed(1)},${(height - pad).toFixed(1)} ` +
    points.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
    ` L${points[points.length - 1].x.toFixed(1)},${(height - pad).toFixed(1)} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`${colorClass} ${className ?? ''}`}
      role="img"
      aria-label={title ?? 'trend sparkline'}
      preserveAspectRatio="none"
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={1.8}
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * RateBar — the thin horizontal rate bar reused by Field Health (populate/write
 * %). Width = rate; color from `barColorClass`.
 */
export function RateBar({
  rate,
  barColorClass,
  width = 64,
}: {
  rate: number;
  barColorClass: string;
  width?: number;
}) {
  const widthPct = Math.max(0, Math.min(1, rate)) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 rounded-full bg-gray-200" style={{ width }}>
        <div className={`h-1.5 rounded-full ${barColorClass}`} style={{ width: `${widthPct}%` }} />
      </div>
      <span className="tabular-nums text-xs text-muted-foreground">{(rate * 100).toFixed(0)}%</span>
    </div>
  );
}
