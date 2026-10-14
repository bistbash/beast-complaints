import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api.ts';
import { STATUS_META, PRIORITY_META, CATEGORIES, groupLabel } from '../utils/constants.ts';
import LoadingScreen from '../components/layout/LoadingScreen.tsx';
import ErrorShell from '../components/layout/ErrorShell.tsx';
import Empty from '../components/ui/Empty.tsx';
import { PIPELINE_STAGES } from '../utils/pipeline.ts';
import { PipelineLegend } from '../components/inquiries/Pipeline.tsx';
import {
  DeltaPill,
  Donut,
  Gauge,
  Sparkline,
  StackedBar,
  TrendChart,
} from '../components/ui/charts.tsx';

/** Time-range keys accepted by the backend `GET /api/inquiries/stats?range=…`. */
type StatsRange = 'all' | '7d' | '30d' | '90d';

const RANGE_TABS: { key: StatsRange; label: string; hint: string }[] = [
  { key: '7d', label: '7 ימים', hint: '' },
  { key: '30d', label: '30 יום', hint: '' },
  { key: '90d', label: '90 יום', hint: '' },
  { key: 'all', label: 'הכל', hint: 'מאז תחילת המעקב' },
];

interface StatsData {
  range: StatsRange;
  periodStart: string | null;
  periodEnd: string | null;
  trendGranularity: 'day' | 'week';
  headline: {
    total: number;
    closed: number;
    open: number;
    avgResolutionHours: number | null;
    closingEmailSent: number;
    closingEmailSentPct: number | null;
    slaMet: number;
    slaBreachedClosed: number;
    slaCompliancePct: number | null;
    slaBreachesOpen: number;
    reopenedCount: number;
    justifiedCount: number;
    unjustifiedCount: number;
    pendingJustificationCount: number;
  };
  previous: {
    total: number;
    closed: number;
    avgResolutionHours: number | null;
    slaMet: number;
    slaCompliancePct: number | null;
  } | null;
  byStatus: Array<{ status: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  byGroup: Array<{ assigned_group: string | null; count: number }>;
  byCategory: Array<{ category: string | null; count: number }>;
  backlogAge: {
    lt1d: number;
    d1to3: number;
    d3to7: number;
    d7to14: number;
    d14plus: number;
  };
  topReporters: Array<{ email: string; full_name: string | null; total: number; open: number }>;
  timings: {
    avgRouteHours: number | null;
    medRouteHours: number | null;
    avgTeamHours: number | null;
    medTeamHours: number | null;
    avgManagerHours: number | null;
    medManagerHours: number | null;
    medianResolutionHours: number | null;
    p90ResolutionHours: number | null;
  };
  trend: Array<{ week: string; bucket: string; created: number; closed: number }>;
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
const PALETTE = [
  '#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b',
  '#f43f5e', '#14b8a6', '#a855f7', '#ec4899',
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const BACKLOG_COLORS = ['#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444'] as const;

const RANGE_LABEL_FOR: Record<StatsRange, string> = {
  '7d': '7 הימים האחרונים',
  '30d': '30 הימים האחרונים',
  '90d': '90 הימים האחרונים',
  all: 'מאז תחילת המעקב',
};

function formatHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h) || h < 0) return '—';
  if (h < 1) return 'פחות משעה';
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} שעות`;
  return `${(h / 24).toFixed(1)} ימים`;
}

function formatBucketLabel(bucket: string, granularity: 'day' | 'week'): string {
  const d = new Date(bucket);
  if (granularity === 'day') {
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
  }
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function formatBucketTooltip(bucket: string, granularity: 'day' | 'week'): string {
  const d = new Date(bucket);
  if (granularity === 'day') {
    return d.toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: 'short' });
  }
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return `שבוע ${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}–${end.toLocaleDateString(
    'he-IL',
    { day: '2-digit', month: '2-digit' },
  )}`;
}

export default function StatsPage() {
  const [range, setRange] = useState<StatsRange>('all');
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const initial = useRef(true);

  const load = useCallback(
    (r: StatsRange, opts: { silent?: boolean } = {}) => {
      if (opts.silent) setRefreshing(true);
      else setLoading(true);
      setError(false);
      api
        .get<StatsData>('/api/inquiries/stats', { params: { range: r } })
        .then((res) => {
          setStats(res.data);
          setLastRefreshed(new Date());
        })
        .catch(() => {
          setStats(null);
          setError(true);
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [],
  );

  useEffect(() => {
    load(range, { silent: !initial.current });
    initial.current = false;
  }, [load, range]);

  if (loading) return <LoadingScreen message="טוען סטטיסטיקות…" />;
  if (error) {
    return (
      <ErrorShell
        title="טעינת הסטטיסטיקות נכשלה"
        description="לא הצלחנו לטעון את לוח הבקרה. בדקו את החיבור ונסו שוב."
        actionLabel="נסה שוב"
        onAction={() => load(range)}
      />
    );
  }

  if (!stats) {
    return (
      <div className="container-max py-8">
        <Empty
          icon={
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M3 3v18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 14l3-3 3 3 4-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
          title="אין עדיין נתונים להצגה"
          description="כשייכנסו פניות למערכת, לוח הבקרה יתמלא בנתונים ומגמות."
        />
      </div>
    );
  }

  return (
    <StatsDashboard
      stats={stats}
      range={range}
      setRange={setRange}
      refreshing={refreshing}
      lastRefreshed={lastRefreshed}
      onRefresh={() => load(range, { silent: true })}
    />
  );
}

function StatsDashboard({
  stats,
  range,
  setRange,
  refreshing,
  lastRefreshed,
  onRefresh,
}: {
  stats: StatsData;
  range: StatsRange;
  setRange: (r: StatsRange) => void;
  refreshing: boolean;
  lastRefreshed: Date | null;
  onRefresh: () => void;
}) {
  const h = stats.headline;
  const prev = stats.previous;

  const statusCount = (k: string) => stats.byStatus.find((s) => s.status === k)?.count ?? 0;
  const total = h.total;
  const nNew = statusCount('new');
  const nClosed = h.closed;
  const nAwait = statusCount('awaiting_manager');

  const funnelCounts = [total, total - nNew, nAwait + nClosed, nClosed, nClosed];

  const statusSlices = stats.byStatus
    .filter((s) => s.count > 0)
    .map((s) => ({
      label: STATUS_META[s.status as keyof typeof STATUS_META]?.label || s.status,
      value: s.count,
      color: STATUS_COLOR[s.status] || '#94a3b8',
    }));

  const trendLabels = stats.trend.map((t) => formatBucketLabel(t.bucket, stats.trendGranularity));
  const trendTooltipLabels = stats.trend.map((t) => formatBucketTooltip(t.bucket, stats.trendGranularity));
  const createdPoints = stats.trend.map((t) => t.created);
  const closedPoints = stats.trend.map((t) => t.closed);

  const stageTimings = [
    {
      def: PIPELINE_STAGES[1],
      avg: stats.timings.avgRouteHours,
      med: stats.timings.medRouteHours,
      label: 'מהגשה ועד ניתוב',
    },
    {
      def: PIPELINE_STAGES[2],
      avg: stats.timings.avgTeamHours,
      med: stats.timings.medTeamHours,
      label: 'מניתוב ועד תגובת הגורם',
    },
    {
      def: PIPELINE_STAGES[3],
      avg: stats.timings.avgManagerHours,
      med: stats.timings.medManagerHours,
      label: 'מהתגובה ועד התייחסות המד"ר',
    },
  ];
  const maxStageHours = Math.max(1, ...stageTimings.map((s) => (s.avg && s.avg > 0 ? s.avg : 0)));

  const backlogSegments = useMemo(() => {
    const { lt1d, d1to3, d3to7, d7to14, d14plus } = stats.backlogAge;
    return [
      { label: 'עד יום', value: lt1d, color: BACKLOG_COLORS[0] },
      { label: '1–3 ימים', value: d1to3, color: BACKLOG_COLORS[1] },
      { label: '3–7 ימים', value: d3to7, color: BACKLOG_COLORS[2] },
      { label: '7–14 ימים', value: d7to14, color: BACKLOG_COLORS[3] },
      { label: '14+ ימים', value: d14plus, color: BACKLOG_COLORS[4] },
    ];
  }, [stats.backlogAge]);
  const backlogTotal = backlogSegments.reduce((s, x) => s + x.value, 0);
  const backlogOld = stats.backlogAge.d7to14 + stats.backlogAge.d14plus;

  const justificationTotal = h.justifiedCount + h.unjustifiedCount + h.pendingJustificationCount;

  return (
    <div className="container-max py-6 md:py-8">
      {/* ───── Header ───── */}
      <header className="stats-hero mb-5">
        <div className="stats-hero-top">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">לוח בקרה — פניות לקוח</h1>
            <p className="muted mt-1 text-sm">
              תמונת מצב לתקופה: <span className="font-medium">{RANGE_LABEL_FOR[range]}</span>
              {lastRefreshed && (
                <>
                  <span className="mx-2">·</span>
                  <span>
                    עודכן: {lastRefreshed.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="stats-hero-actions">
            <div className="range-toggle" role="tablist" aria-label="טווח זמן">
              {RANGE_TABS.map((tab) => (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={range === tab.key}
                  className="range-toggle-btn"
                  data-active={range === tab.key}
                  onClick={() => setRange(tab.key)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-ghost-icon"
              onClick={onRefresh}
              disabled={refreshing}
              title="רענן"
              aria-label="רענן נתונים"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                className={refreshing ? 'refresh-spin' : undefined}>
                <path d="M21 12a9 9 0 1 1-3.2-6.9" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" />
                <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="stats-hero-pipeline">
          <PipelineLegend />
        </div>
      </header>

      {/* ───── KPI row ───── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="סך הפניות בתקופה"
          value={total}
          color="slate"
          sub={
            range === 'all'
              ? 'מאז תחילת המעקב'
              : `${nNew.toLocaleString('he-IL')} ממתינות לניתוב`
          }
          spark={createdPoints}
          sparkColor="#6366f1"
          delta={prev ? { current: total, previous: prev.total } : null}
        />
        <KpiCard
          label="פתוחות בטיפול"
          value={h.open}
          color="indigo"
          sub={
            backlogOld > 0
              ? `${backlogOld.toLocaleString('he-IL')} מעל 7 ימים`
              : 'כל התיבה בזמן הטיפול'
          }
          delta={prev ? { current: h.open, previous: prev.total - prev.closed, inverted: true } : null}
        />
        <KpiCard
          label="הושלמו ונסגרו"
          value={nClosed}
          color="emerald"
          sub={total ? `${Math.round((nClosed / total) * 100)}% מהתקופה` : undefined}
          spark={closedPoints}
          sparkColor="#10b981"
          delta={prev ? { current: nClosed, previous: prev.closed } : null}
        />
        <KpiCard
          label="חריגות SLA פתוחות"
          value={h.slaBreachesOpen}
          color={h.slaBreachesOpen > 0 ? 'amber' : 'emerald'}
          sub={
            h.slaBreachesOpen > 0
              ? 'דורשות התייחסות מיידית'
              : 'אין חריגות פתוחות כרגע'
          }
        />
      </div>

      {/* ───── SLA + backlog + justification ───── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">עמידה ב-SLA</h2>
            <span className="muted text-xs">מבין הפניות שנסגרו</span>
          </div>
          <div className="mt-3 flex justify-center">
            <Gauge
              value={h.slaCompliancePct}
              label="נסגרו בזמן"
              hint={
                nClosed > 0
                  ? `${h.slaMet.toLocaleString('he-IL')} מתוך ${nClosed.toLocaleString('he-IL')} בזמן`
                  : 'אין עדיין פניות סגורות'
              }
            />
          </div>
          {prev?.slaCompliancePct != null && h.slaCompliancePct != null && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs">
              <span className="muted">מהתקופה הקודמת:</span>
              <DeltaPill
                current={h.slaCompliancePct}
                previous={prev.slaCompliancePct}
                suffix="pp"
              />
            </div>
          )}
        </section>

        <section className="card lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">גיל הפניות הפתוחות</h2>
            <span className="muted text-xs">
              {backlogTotal > 0
                ? `${backlogTotal.toLocaleString('he-IL')} פניות פתוחות`
                : 'אין פניות פתוחות כרגע'}
            </span>
          </div>
          <div className="mt-4">
            <StackedBar
              segments={backlogSegments}
              ariaLabel={`גיל פניות פתוחות: ${backlogSegments.map((s) => `${s.label} ${s.value}`).join(', ')}`}
            />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {backlogSegments.map((s) => (
                <div key={s.label} className="backlog-legend">
                  <span className="legend-dot" style={{ background: s.color }} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{s.label}</div>
                    <div className="text-sm font-bold tabular-nums">{s.value.toLocaleString('he-IL')}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {h.reopenedCount > 0 && (
            <div className="mt-4 panel-sunken flex items-start gap-2 text-xs">
              <span className="reopened-badge">↻</span>
              <div>
                <div className="font-semibold">{h.reopenedCount.toLocaleString('he-IL')} פניות נפתחו מחדש</div>
                <div className="muted mt-0.5">בתקופה זו — כדאי לבדוק אם יש בעיה חוזרת שלא נפתרה.</div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ───── Funnel + status donut ───── */}
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
                    <div
                      className="funnel-bar-fill"
                      style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}
                    >
                      {count > 0 && <span className="tabular-nums">{count.toLocaleString('he-IL')}</span>}
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
                  <span className="font-semibold tabular-nums">{s.value.toLocaleString('he-IL')}</span>
                  <span className="muted w-9 text-left text-xs tabular-nums">
                    {total ? Math.round((s.value / total) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* ───── Trend ───── */}
      <section className="card mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">מגמת פניות</h2>
            <p className="muted mt-0.5 text-xs">
              {stats.trendGranularity === 'day'
                ? `נפתחו/נסגרו — לפי יום, ${trendLabels.length} ימים אחרונים`
                : `נפתחו/נסגרו — לפי שבוע, ${trendLabels.length} שבועות אחרונים`}
            </p>
          </div>
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
            tooltipLabels={trendTooltipLabels}
            series={[
              { label: 'נפתחו', color: '#6366f1', points: createdPoints },
              { label: 'נסגרו', color: '#10b981', points: closedPoints },
            ]}
          />
        </div>
      </section>

      {/* ───── Stage timings ───── */}
      <section className="card mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">זמני טיפול לפי שלב</h2>
          <span className="muted text-xs">זמן ממוצע וחציוני ששוהה הפנייה בכל שלב</span>
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-[1.5fr,1fr] lg:items-center">
          <div className="space-y-3">
            {stageTimings.map((s) => {
              const pct = s.avg && s.avg > 0 ? (s.avg / maxStageHours) * 100 : 0;
              return (
                <div key={s.def.key} className="stage" data-color={s.def.color}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium">{s.label}</span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-semibold tabular-nums">{formatHours(s.avg)}</span>
                      <span className="muted text-xs tabular-nums">חציון {formatHours(s.med)}</span>
                    </span>
                  </div>
                  <div className="dash-bar-track">
                    <div
                      className="dash-bar-fill"
                      style={{
                        width: `${Math.max(pct, s.avg ? 4 : 0)}%`,
                        background: 'rgb(var(--stage) / 1)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <MiniStat label="זמן טיפול חציוני" value={formatHours(stats.timings.medianResolutionHours)} />
            <MiniStat label="זמן טיפול ממוצע" value={formatHours(h.avgResolutionHours)} />
            <MiniStat label="90% מהפניות תוך" value={formatHours(stats.timings.p90ResolutionHours)} />
            <MiniStat
              label="נשלח מייל סגירה"
              value={
                nClosed
                  ? `${h.closingEmailSent.toLocaleString('he-IL')} / ${nClosed.toLocaleString('he-IL')}`
                  : '—'
              }
              hint={h.closingEmailSentPct != null ? `${h.closingEmailSentPct}%` : undefined}
            />
          </div>
        </div>
      </section>

      {/* ───── Justification split + Top reporters ───── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr,1.4fr]">
        <section className="card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">מוצדקות מול לא מוצדקות</h2>
            <span className="muted text-xs">מבין הפניות שנסגרו</span>
          </div>
          {justificationTotal === 0 ? (
            <p className="muted mt-4 text-sm">אין עדיין פניות סגורות שסומנו.</p>
          ) : (
            <div className="mt-4 space-y-3">
              <StackedBar
                segments={[
                  { label: 'מוצדקות', value: h.justifiedCount, color: '#f59e0b' },
                  { label: 'לא מוצדקות', value: h.unjustifiedCount, color: '#64748b' },
                  { label: 'לא סומן', value: h.pendingJustificationCount, color: '#cbd5e1' },
                ]}
                ariaLabel={`מוצדקות ${h.justifiedCount}, לא מוצדקות ${h.unjustifiedCount}, לא סומן ${h.pendingJustificationCount}`}
              />
              <ul className="mt-2 space-y-2 text-sm">
                <JustificationRow
                  color="#f59e0b"
                  label="מוצדקות"
                  count={h.justifiedCount}
                  total={justificationTotal}
                />
                <JustificationRow
                  color="#64748b"
                  label="לא מוצדקות"
                  count={h.unjustifiedCount}
                  total={justificationTotal}
                />
                {h.pendingJustificationCount > 0 && (
                  <JustificationRow
                    color="#cbd5e1"
                    label="לא סומן"
                    count={h.pendingJustificationCount}
                    total={justificationTotal}
                  />
                )}
              </ul>
            </div>
          )}
        </section>

        <section className="card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">פונים בולטים</h2>
            <span className="muted text-xs">5 בעלי הכמות הגבוהה ביותר</span>
          </div>
          {stats.topReporters.length === 0 ? (
            <p className="muted mt-4 text-sm">אין נתונים.</p>
          ) : (
            <ol className="mt-3 space-y-2 text-sm">
              {stats.topReporters.map((r, i) => (
                <li key={r.email} className="top-reporter-row">
                  <span className="top-reporter-rank">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {r.full_name || r.email}
                    </div>
                    <div className="muted truncate text-xs">{r.email}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {r.open > 0 && (
                      <span className="top-reporter-open" title="פתוחות">
                        {r.open.toLocaleString('he-IL')} פתוחות
                      </span>
                    )}
                    <span className="font-bold tabular-nums">
                      {r.total.toLocaleString('he-IL')}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* ───── Breakdowns ───── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <BreakdownCard
          title="לפי דחיפות"
          rows={stats.byPriority
            .filter((r) => r.count > 0)
            .sort(
              (a, b) =>
                (PRIORITY_META[a.priority as keyof typeof PRIORITY_META]?.weight ?? 9) -
                (PRIORITY_META[b.priority as keyof typeof PRIORITY_META]?.weight ?? 9),
            )
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
            .map((r, i) => ({
              label: groupLabel(r.assigned_group),
              value: r.count,
              color: PALETTE[i % PALETTE.length],
            }))
            .concat(
              stats.byGroup.find((r) => !r.assigned_group)
                ? [
                    {
                      label: 'ללא ניתוב',
                      value: stats.byGroup.find((r) => !r.assigned_group)!.count,
                      color: '#cbd5e1',
                    },
                  ]
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

/** KPI tile — big number + optional sparkline + optional delta vs previous period. */
function KpiCard({
  label,
  value,
  color,
  sub,
  spark,
  sparkColor,
  delta,
}: {
  label: string;
  value: number;
  color: 'slate' | 'indigo' | 'violet' | 'amber' | 'emerald';
  sub?: string;
  spark?: number[];
  sparkColor?: string;
  delta?: { current: number; previous: number; inverted?: boolean } | null;
}) {
  const hasSpark = spark && spark.length >= 2 && spark.some((n) => n > 0);
  return (
    <div className="stage stat-card kpi-card" data-color={color}>
      <span className="stat-accent" />
      <div className="flex items-start justify-between gap-2">
        <div className="stat-label">{label}</div>
        {delta && (
          <DeltaPill current={delta.current} previous={delta.previous} inverted={delta.inverted} />
        )}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="stat-value tabular-nums" style={{ color: 'rgb(var(--stage) / 1)' }}>
          {value.toLocaleString('he-IL')}
        </div>
        {hasSpark && sparkColor && (
          <div className="stat-spark-inline" aria-hidden>
            <Sparkline points={spark!} color={sparkColor} />
          </div>
        )}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel-sunken">
      <div className="muted text-xs font-medium">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-xl font-bold tabular-nums">{value}</div>
        {hint && <div className="muted text-xs tabular-nums">{hint}</div>}
      </div>
    </div>
  );
}

function JustificationRow({
  color,
  label,
  count,
  total,
}: {
  color: string;
  label: string;
  count: number;
  total: number;
}) {
  return (
    <li className="flex items-center gap-2">
      <span className="legend-dot" style={{ background: color }} />
      <span className="flex-1">{label}</span>
      <span className="font-semibold tabular-nums">{count.toLocaleString('he-IL')}</span>
      <span className="muted w-9 text-left text-xs tabular-nums">
        {total ? Math.round((count / total) * 100) : 0}%
      </span>
    </li>
  );
}

function BreakdownCard({
  title,
  rows,
  total,
  emptyHint = 'אין נתונים',
}: {
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
                {r.value.toLocaleString('he-IL')}
                <span className="mr-1 text-xs">
                  ({total ? Math.round((r.value / total) * 100) : 0}%)
                </span>
              </span>
            </div>
            <div className="dash-bar-track">
              <div
                className="dash-bar-fill"
                style={{ width: `${Math.max((r.value / max) * 100, 4)}%`, background: r.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
