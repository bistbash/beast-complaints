import { useEffect, useState } from 'react';
import api from '../utils/api.ts';
import { STATUS_META, PRIORITY_META, CATEGORIES, groupLabel } from '../utils/constants.ts';
import LoadingScreen from '../components/layout/LoadingScreen.tsx';
import { PIPELINE_STAGES } from '../utils/pipeline.ts';
import { PipelineLegend } from '../components/inquiries/Pipeline.tsx';
import { Donut, TrendChart } from '../components/ui/charts.tsx';

interface StatsData {
  byStatus: Array<{ status: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  byGroup: Array<{ assigned_group: string | null; count: number }>;
  byCategory: Array<{ category: string | null; count: number }>;
  slaBreaches: number;
  avgResolutionHours: number | null;
  timings: {
    avgRouteHours: number | null;
    avgTeamHours: number | null;
    avgManagerHours: number | null;
    medianResolutionHours: number | null;
  };
  trend: Array<{ week: string; created: number; closed: number }>;
}

const STATUS_COLOR: Record<string, string> = {
  new: '#f59e0b',
  routed: '#6366f1',
  awaiting_manager: '#8b5cf6',
  closed: '#10b981',
};
const PRIORITY_COLOR: Record<string, string> = {
  low: '#64748b',
  medium: '#0ea5e9',
  high: '#f59e0b',
  urgent: '#f43f5e',
};
const PALETTE = ['#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#14b8a6', '#a855f7', '#ec4899'];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

function formatHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h) || h < 0) return '—';
  if (h < 1) return 'פחות משעה';
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} שעות`;
  return `${(h / 24).toFixed(1)} ימים`;
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/api/inquiries/stats')
      .then((res) => setStats(res.data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingScreen message="טוען סטטיסטיקות…" />;
  if (!stats) {
    return (
      <div className="container-max py-8">
        <p className="muted">אין נתונים זמינים.</p>
      </div>
    );
  }

  const statusCount = (k: string) => stats.byStatus.find((s) => s.status === k)?.count ?? 0;
  const total = stats.byStatus.reduce((sum, s) => sum + s.count, 0);
  const nNew = statusCount('new');
  const nClosed = statusCount('closed');
  const open = total - nClosed;
  const nAwait = statusCount('awaiting_manager');

  // Cumulative pipeline funnel — how many inquiries have passed each milestone.
  const funnelCounts = [total, total - nNew, nAwait + nClosed, nClosed, nClosed];

  const statusSlices = stats.byStatus
    .filter((s) => s.count > 0)
    .map((s) => ({
      label: STATUS_META[s.status as keyof typeof STATUS_META]?.label || s.status,
      value: s.count,
      color: STATUS_COLOR[s.status] || '#94a3b8',
    }));

  const trendLabels = stats.trend.map((t) =>
    new Date(t.week).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }),
  );

  const stageTimings = [
    { def: PIPELINE_STAGES[1], hours: stats.timings.avgRouteHours, label: 'מהגשה ועד ניתוב' },
    { def: PIPELINE_STAGES[2], hours: stats.timings.avgTeamHours, label: 'מניתוב ועד תגובת הגורם' },
    { def: PIPELINE_STAGES[3], hours: stats.timings.avgManagerHours, label: 'מהתגובה ועד התייחסות המד"ר' },
  ];
  const maxStageHours = Math.max(1, ...stageTimings.map((s) => (s.hours && s.hours > 0 ? s.hours : 0)));

  return (
    <div className="container-max py-6 md:py-8">
      <header className="mb-6 overflow-hidden rounded-2xl border border-subtle bg-gradient-to-l from-indigo-50/60 via-surface to-surface p-5 dark:from-indigo-950/30 dark:via-surface dark:to-surface">
        <h1 className="text-2xl font-bold tracking-tight">לוח בקרה — פניות לקוח</h1>
        <p className="muted mt-1 text-sm">תמונת מצב של כלל הפניות ומסע הטיפול בהן.</p>
        <div className="mt-4 border-t border-subtle/70 pt-3">
          <PipelineLegend />
        </div>
      </header>

      {/* === KPI row === */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="סך הפניות" value={total} color="slate" sub="מאז תחילת המעקב" />
        <StatCard label="פתוחות בטיפול" value={open} color="indigo" sub={`${nNew} ממתינות לניתוב`} />
        <StatCard label="הושלמו ונסגרו" value={nClosed} color="emerald"
          sub={total ? `${Math.round((nClosed / total) * 100)}% מכלל הפניות` : undefined} />
        <StatCard label="חריגות SLA" value={stats.slaBreaches} color="amber"
          sub={stats.slaBreaches > 0 ? 'דורשות התייחסות מיידית' : 'אין חריגות פתוחות'} />
      </div>

      {/* === Funnel + status donut === */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr,1fr]">
        <section className="card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">מסע הפנייה — נפח בכל שלב</h2>
            <span className="muted text-xs">כמה פניות עברו כל שלב</span>
          </div>
          <div className="mt-4 space-y-2.5">
            {PIPELINE_STAGES.map((def, i) => {
              const count = funnelCounts[i];
              const pct = total ? (count / total) * 100 : 0;
              return (
                <div key={def.key} className="stage funnel-row" data-color={def.color}>
                  <div className="w-28 shrink-0 text-xs font-medium sm:w-36 sm:text-sm">{def.title}</div>
                  <div className="funnel-bar-track">
                    <div className="funnel-bar-fill" style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}>
                      {count > 0 && <span className="tabular-nums">{count}</span>}
                    </div>
                  </div>
                  <div className="muted w-10 shrink-0 text-left text-xs tabular-nums">{Math.round(pct)}%</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card">
          <h2 className="text-sm font-semibold">לפי סטטוס</h2>
          <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
            <Donut data={statusSlices} centerValue={total} centerLabel="פניות" />
            <ul className="flex-1 space-y-2 self-stretch">
              {statusSlices.length === 0 && <li className="muted text-sm">אין נתונים</li>}
              {statusSlices.map((s) => (
                <li key={s.label} className="flex items-center gap-2 text-sm">
                  <span className="legend-dot" style={{ background: s.color }} />
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="font-semibold tabular-nums">{s.value}</span>
                  <span className="muted w-9 text-left text-xs tabular-nums">
                    {total ? Math.round((s.value / total) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* === Trend === */}
      <section className="card mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">מגמת פניות — 12 שבועות אחרונים</h2>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="legend-dot" style={{ background: '#6366f1' }} /> נפתחו
            </span>
            <span className="flex items-center gap-1.5">
              <span className="legend-dot" style={{ background: '#10b981' }} /> נסגרו
            </span>
          </div>
        </div>
        <div className="mt-4">
          <TrendChart
            labels={trendLabels}
            series={[
              { label: 'נפתחו', color: '#6366f1', points: stats.trend.map((t) => t.created) },
              { label: 'נסגרו', color: '#10b981', points: stats.trend.map((t) => t.closed) },
            ]}
          />
        </div>
      </section>

      {/* === Stage timings === */}
      <section className="card mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">זמני טיפול לפי שלב</h2>
          <span className="muted text-xs">זמן ממוצע ששוהה הפנייה בכל שלב</span>
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-[1.5fr,1fr] lg:items-center">
          <div className="space-y-3">
            {stageTimings.map((s) => {
              const pct = s.hours && s.hours > 0 ? (s.hours / maxStageHours) * 100 : 0;
              return (
                <div key={s.def.key} className="stage" data-color={s.def.color}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium">{s.label}</span>
                    <span className="font-semibold tabular-nums">{formatHours(s.hours)}</span>
                  </div>
                  <div className="dash-bar-track">
                    <div className="dash-bar-fill" style={{ width: `${Math.max(pct, s.hours ? 4 : 0)}%`, background: 'rgb(var(--stage) / 1)' }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <MiniStat label="זמן טיפול חציוני" value={formatHours(stats.timings.medianResolutionHours)} />
            <MiniStat label="זמן טיפול ממוצע" value={formatHours(stats.avgResolutionHours)} />
          </div>
        </div>
      </section>

      {/* === Breakdowns === */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <BreakdownCard
          title="לפי דחיפות"
          rows={stats.byPriority
            .filter((r) => r.count > 0)
            .sort((a, b) => (PRIORITY_META[a.priority as keyof typeof PRIORITY_META]?.weight ?? 9) -
              (PRIORITY_META[b.priority as keyof typeof PRIORITY_META]?.weight ?? 9))
            .map((r) => ({
              label: PRIORITY_META[r.priority as keyof typeof PRIORITY_META]?.label || r.priority,
              value: r.count,
              color: PRIORITY_COLOR[r.priority] || '#94a3b8',
            }))}
          total={total}
        />
        <BreakdownCard
          title="לפי קבוצה"
          rows={stats.byGroup
            .filter((r) => r.assigned_group)
            .sort((a, b) => b.count - a.count)
            .map((r, i) => ({ label: groupLabel(r.assigned_group), value: r.count, color: PALETTE[i % PALETTE.length] }))
            .concat(
              stats.byGroup.find((r) => !r.assigned_group)
                ? [{ label: 'ללא ניתוב', value: stats.byGroup.find((r) => !r.assigned_group)!.count, color: '#cbd5e1' }]
                : [],
            )}
          total={total}
        />
        <BreakdownCard
          title="לפי קטגוריה"
          rows={stats.byCategory
            .filter((r) => r.category)
            .sort((a, b) => b.count - a.count)
            .map((r, i) => ({
              label: CATEGORY_LABEL[r.category as string] || (r.category as string),
              value: r.count,
              color: PALETTE[(i + 3) % PALETTE.length],
            }))}
          total={total}
          emptyHint="לא תויגו קטגוריות"
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, color, sub }: {
  label: string;
  value: number;
  color: 'slate' | 'indigo' | 'violet' | 'amber' | 'emerald';
  sub?: string;
}) {
  return (
    <div className="stage stat-card" data-color={color}>
      <span className="stat-accent" />
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular-nums" style={{ color: 'rgb(var(--stage) / 1)' }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-sunken">
      <div className="muted text-xs font-medium">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function BreakdownCard({ title, rows, total, emptyHint = 'אין נתונים' }: {
  title: string;
  rows: Array<{ label: string; value: number; color: string }>;
  total: number;
  emptyHint?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="card">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 space-y-3">
        {rows.length === 0 && <p className="muted text-sm">{emptyHint}</p>}
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className="legend-dot" style={{ background: r.color }} />
                <span className="font-medium">{r.label}</span>
              </span>
              <span className="muted tabular-nums">
                {r.value}
                <span className="mr-1 text-xs">({total ? Math.round((r.value / total) * 100) : 0}%)</span>
              </span>
            </div>
            <div className="dash-bar-track">
              <div className="dash-bar-fill" style={{ width: `${Math.max((r.value / max) * 100, 4)}%`, background: r.color }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
