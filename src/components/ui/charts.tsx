/**
 * Tiny dependency-free SVG charts for the stats dashboard.
 * Kept deliberately small — donut for distribution, trend for time series,
 * sparkline for stat-card flourishes.
 */

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

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="התפלגות">
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

/** Dual area/line time-series. Expects all series to share `labels` length. */
export function TrendChart({ series, labels, height = 220 }: {
  series: TrendSeries[];
  labels: string[];
  height?: number;
}) {
  const W = 760;
  const H = height;
  const padX = 14;
  const padTop = 16;
  const padBottom = 26;
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const plotW = W - padX * 2;
  const plotH = H - padTop - padBottom;
  // RTL: earliest week on the right, newest on the left, matching reading order.
  const x = (i: number) => padX + plotW - (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="מגמה לאורך זמן">
      {/* horizontal gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1={padX} x2={W - padX} y1={padTop + plotH * g} y2={padTop + plotH * g}
          stroke="rgb(var(--border) / 0.7)" strokeWidth={1} strokeDasharray="3 4" />
      ))}
      {series.map((s) => {
        const line = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p)}`).join(' ');
        const area = `${line} L ${x(n - 1)} ${padTop + plotH} L ${x(0)} ${padTop + plotH} Z`;
        return (
          <g key={s.label}>
            <path d={area} fill={s.color} opacity={0.1} />
            <path d={line} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((p, i) => (
              <circle key={i} cx={x(i)} cy={y(p)} r={n > 8 ? 2.5 : 3.5} fill={s.color} />
            ))}
          </g>
        );
      })}
      {/* sparse x labels (every other week to avoid crowding) */}
      {labels.map((l, i) =>
        i % 2 === 0 || n <= 6 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle"
            style={{ fontSize: 11, fill: 'rgb(var(--muted))' }}>
            {l}
          </text>
        ) : null,
      )}
    </svg>
  );
}
