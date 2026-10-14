/**
 * Tiny dependency-free SVG charts for the stats dashboard.
 * Kept deliberately small — donut for distribution, trend for time series,
 * sparkline for stat-card flourishes, gauge for SLA compliance, and a
 * horizontal age-bucket bar for the backlog view.
 *
 * All components describe their data via `aria-label` so screen readers get
 * the numbers, not just "image".
 */

import { useMemo, useState } from 'react';

export interface Slice {
  label: string;
  value: number;
  /** Any CSS colour. */
  color: string;
}

/** Ring chart with a value in the hole. Segments render clockwise from top. */
export function Donut({ data, size = 168, thickness = 22, centerValue, centerLabel }: {
  data: Slice[];
  size?: number;
  thickness?: number;
  centerValue?: string | number;
  centerLabel?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let offset = 0;

  const ariaLabel =
    total > 0
      ? `התפלגות: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`
      : 'התפלגות — אין נתונים';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgb(var(--surface-sunken) / 1)" strokeWidth={thickness} />
        {total > 0 &&
          data.map((d) => {
            const len = (d.value / total) * c;
            const seg = (
              <circle
                key={d.label}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(len - 1.5, 0)} ${c - Math.max(len - 1.5, 0)}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.22,1,0.36,1)' }}
              />
            );
            offset += len;
            return seg;
          })}
      </g>
      {(centerValue !== undefined || centerLabel) && (
        <g>
          <text x={cx} y={cx - 2} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: size * 0.2, fontWeight: 800, fill: 'rgb(var(--text))' }}>
            {centerValue}
          </text>
          {centerLabel && (
            <text x={cx} y={cx + size * 0.13} textAnchor="middle" dominantBaseline="middle"
              style={{ fontSize: size * 0.075, fill: 'rgb(var(--muted))' }}>
              {centerLabel}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

export interface TrendSeries {
  label: string;
  color: string;
  points: number[];
}

/**
 * Dual area/line time-series with hover tooltip and a value axis.
 * All series must share the same `labels.length`.
 *
 * Coordinates are RTL: earliest point on the right, newest on the left, so it
 * reads with the Hebrew UI. Hovering a column highlights it and pins the
 * tooltip inside the chart bounds.
 */
export function TrendChart({ series, labels, height = 240, tooltipLabels }: {
  series: TrendSeries[];
  labels: string[];
  height?: number;
  /** Full labels shown in tooltip (e.g. long date). Defaults to `labels`. */
  tooltipLabels?: string[];
}) {
  const W = 760;
  const H = height;
  const padX = 24;
  const padTop = 18;
  const padBottom = 28;
  const padLeft = 34; // room for y-axis ticks
  const n = labels.length;
  const rawMax = Math.max(1, ...series.flatMap((s) => s.points));
  // Round the y-axis top up to a "nice" number so ticks are round.
  const max = niceCeil(rawMax);
  const plotW = W - padX - padLeft;
  const plotH = H - padTop - padBottom;
  const x = (i: number) => padLeft + plotW - (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padTop + plotH - (v / max) * plotH;
  const [hover, setHover] = useState<number | null>(null);

  const ariaLabel = `מגמה לאורך זמן — ${series
    .map((s) => `${s.label}: ${s.points.reduce((a, b) => a + b, 0)} סה"כ`)
    .join('; ')}`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const showEvery = n > 14 ? Math.ceil(n / 8) : n > 6 ? 2 : 1;

  const columnWidth = plotW / Math.max(n - 1, 1);
  const tipLabels = tooltipLabels ?? labels;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      onMouseLeave={() => setHover(null)}
      style={{ touchAction: 'none' }}
    >
      {yTicks.map((g) => {
        const yy = padTop + plotH * g;
        const val = Math.round(max * (1 - g));
        return (
          <g key={g}>
            <line x1={padLeft} x2={W - padX} y1={yy} y2={yy}
              stroke="rgb(var(--border) / 0.75)" strokeWidth={1} strokeDasharray="3 4" />
            <text x={padLeft - 6} y={yy} textAnchor="end" dominantBaseline="middle"
              style={{ fontSize: 10, fill: 'rgb(var(--muted))' }}>
              {val}
            </text>
          </g>
        );
      })}

      {/* Invisible mouse-catch columns per point — gives generous hover targets. */}
      {labels.map((_, i) => (
        <rect
          key={i}
          x={x(i) - columnWidth / 2}
          y={padTop}
          width={Math.max(columnWidth, 6)}
          height={plotH}
          fill="transparent"
          onMouseEnter={() => setHover(i)}
        />
      ))}

      {hover != null && (
        <line
          x1={x(hover)}
          x2={x(hover)}
          y1={padTop}
          y2={padTop + plotH}
          stroke="rgb(var(--muted) / 0.35)"
          strokeWidth={1}
        />
      )}

      {series.map((s) => {
        const line = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p)}`).join(' ');
        const area = `${line} L ${x(n - 1)} ${padTop + plotH} L ${x(0)} ${padTop + plotH} Z`;
        return (
          <g key={s.label}>
            <path d={area} fill={s.color} opacity={0.12} />
            <path d={line} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((p, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(p)}
                r={hover === i ? 5 : n > 14 ? 2 : 3.2}
                fill={s.color}
                style={{ transition: 'r 120ms ease' }}
              />
            ))}
          </g>
        );
      })}

      {labels.map((l, i) =>
        i % showEvery === 0 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle"
            style={{ fontSize: 11, fill: 'rgb(var(--muted))' }}>
            {l}
          </text>
        ) : null,
      )}

      {hover != null && (
        <TrendTooltip
          x={x(hover)}
          plotLeft={padLeft}
          plotRight={W - padX}
          series={series.map((s) => ({ label: s.label, color: s.color, value: s.points[hover] ?? 0 }))}
          title={tipLabels[hover] ?? labels[hover]}
        />
      )}
    </svg>
  );
}

function TrendTooltip({ x, plotLeft, plotRight, series, title }: {
  x: number;
  plotLeft: number;
  plotRight: number;
  series: Array<{ label: string; color: string; value: number }>;
  title: string;
}) {
  const width = 148;
  const rowH = 16;
  const height = 26 + rowH * series.length;
  let boxX = x - width / 2;
  if (boxX < plotLeft) boxX = plotLeft;
  if (boxX + width > plotRight) boxX = plotRight - width;
  const boxY = 8;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={boxX} y={boxY} width={width} height={height} rx={8}
        fill="rgb(var(--surface) / 0.98)" stroke="rgb(var(--border) / 1)" />
      <text x={boxX + 10} y={boxY + 15}
        style={{ fontSize: 11, fontWeight: 700, fill: 'rgb(var(--text))' }}>
        {title}
      </text>
      {series.map((s, i) => (
        <g key={s.label} transform={`translate(${boxX + 10}, ${boxY + 22 + i * rowH + 8})`}>
          <rect x={0} y={-5} width={7} height={7} fill={s.color} rx={2} />
          <text x={12} y={2} style={{ fontSize: 11, fill: 'rgb(var(--muted))' }}>
            {s.label}
          </text>
          <text x={width - 20} y={2} textAnchor="end"
            style={{ fontSize: 11, fontWeight: 700, fill: 'rgb(var(--text))' }}>
            {s.value}
          </text>
        </g>
      ))}
    </g>
  );
}

/** A small inline area chart for KPI cards. */
export function Sparkline({ points, color, width = 96, height = 28, fillOpacity = 0.18 }: {
  points: number[];
  color: string;
  width?: number;
  height?: number;
  fillOpacity?: number;
}) {
  const n = points.length;
  if (n === 0) return null;
  const max = Math.max(1, ...points);
  const min = Math.min(0, ...points);
  const range = Math.max(1, max - min);
  // RTL: newest on the left, oldest on the right — matches the trend chart.
  const x = (i: number) => (n === 1 ? width / 2 : width - (i / (n - 1)) * width);
  const y = (v: number) => height - ((v - min) / range) * height;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p)}`).join(' ');
  const area = `${line} L ${x(n - 1)} ${height} L ${x(0)} ${height} Z`;
  const total = points.reduce((a, b) => a + b, 0);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`מגמה — סה"כ ${total} על פני ${n} נקודות`}
      preserveAspectRatio="none"
    >
      <path d={area} fill={color} opacity={fillOpacity} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Semicircle gauge used for the SLA compliance %. `value` is 0–100; the arc
 * fills clockwise (right→left in an RTL page) and colour-shifts from
 * emerald (>=80) to amber (>=60) to danger (<60).
 */
export function Gauge({
  value,
  size = 200,
  thickness = 18,
  label,
  hint,
}: {
  value: number | null;
  size?: number;
  thickness?: number;
  label?: string;
  hint?: string;
}) {
  const H = size / 2 + thickness;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const c = Math.PI * r; // half circumference
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const filled = v == null ? 0 : (v / 100) * c;
  const color = v == null
    ? 'rgb(var(--muted) / 0.6)'
    : v >= 80
      ? '#10b981'
      : v >= 60
        ? '#f59e0b'
        : '#f43f5e';

  const ariaLabel = v == null ? `${label ?? 'מדד'} — אין נתונים` : `${label ?? 'מדד'} ${v}%`;

  return (
    <div className="gauge-wrap" role="img" aria-label={ariaLabel}>
      <svg width={size} height={H + 6} viewBox={`0 0 ${size} ${H + 6}`}>
        <g transform={`rotate(180 ${cx} ${cy})`}>
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke="rgb(var(--surface-sunken) / 1)" strokeWidth={thickness}
            strokeDasharray={`${c} ${c}`} strokeDashoffset={0} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke={color} strokeWidth={thickness}
            strokeDasharray={`${filled} ${c}`} strokeDashoffset={0}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.22,1,0.36,1)' }} />
        </g>
        <text x={cx} y={cy + 4} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: size * 0.22, fontWeight: 800, fill: 'rgb(var(--text))' }}>
          {v == null ? '—' : `${v}%`}
        </text>
        {label && (
          <text x={cx} y={cy + size * 0.18} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: size * 0.075, fill: 'rgb(var(--muted))' }}>
            {label}
          </text>
        )}
      </svg>
      {hint && <div className="muted mt-1 text-center text-xs">{hint}</div>}
    </div>
  );
}

/**
 * Stacked horizontal bar for age buckets. The bar reads right-to-left (RTL):
 * "youngest" bucket sits on the right, "oldest" on the left. Colours grow
 * warmer as age increases, mirroring the funnel-of-attention idea.
 */
export function StackedBar({ segments, height = 28, ariaLabel }: {
  segments: Array<{ label: string; value: number; color: string }>;
  height?: number;
  ariaLabel: string;
}) {
  const total = segments.reduce((s, r) => s + r.value, 0);
  return (
    <div
      className="stacked-bar-track"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
      title={segments.map((s) => `${s.label}: ${s.value}`).join('  •  ')}
    >
      {total === 0 && <span className="stacked-bar-empty">—</span>}
      {total > 0 &&
        segments.map((s, i) => {
          const pct = (s.value / total) * 100;
          if (pct <= 0) return null;
          return (
            <span
              key={i}
              className="stacked-bar-seg"
              style={{ width: `${pct}%`, background: s.color }}
              aria-hidden
            >
              {pct >= 8 ? <span className="stacked-bar-num tabular-nums">{s.value}</span> : null}
            </span>
          );
        })}
    </div>
  );
}

/** Delta pill: shows the change vs previous period with an arrow and colour. */
export function DeltaPill({ current, previous, inverted = false, suffix = '' }: {
  current: number | null | undefined;
  previous: number | null | undefined;
  /** If true, a lower value is treated as "good" (green). Default: higher is good. */
  inverted?: boolean;
  /** Extra unit hint after the number (e.g. "%"). */
  suffix?: string;
}) {
  const info = useMemo(() => {
    if (current == null || previous == null) return null;
    if (previous === 0 && current === 0) return { text: '—', tone: 'neutral' as const, arrow: '' };
    if (previous === 0) return { text: 'חדש', tone: 'accent' as const, arrow: '' };
    const diff = current - previous;
    const pct = Math.round((diff / previous) * 100);
    const rising = diff > 0;
    const good = inverted ? !rising : rising;
    const tone: 'good' | 'bad' | 'neutral' = diff === 0 ? 'neutral' : good ? 'good' : 'bad';
    return {
      text: `${diff === 0 ? '' : rising ? '+' : ''}${pct}%${suffix}`,
      tone,
      arrow: diff === 0 ? '' : rising ? '↑' : '↓',
    };
  }, [current, previous, inverted, suffix]);

  if (!info) return null;
  return (
    <span className="delta-pill" data-tone={info.tone}>
      {info.arrow && <span className="delta-arrow">{info.arrow}</span>}
      {info.text}
    </span>
  );
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  let m: number;
  if (n <= 1) m = 1;
  else if (n <= 2) m = 2;
  else if (n <= 5) m = 5;
  else m = 10;
  return m * pow;
}
