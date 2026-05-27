import { useEffect, useState } from 'react';
import api from '../utils/api.ts';
import Card from '../components/ui/Card.tsx';
import { STATUS_META, PRIORITY_META, groupLabel } from '../utils/constants.ts';
import LoadingScreen from '../components/layout/LoadingScreen.tsx';

interface StatsData {
  byStatus: Array<{ status: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  byGroup: Array<{ assigned_group: string | null; count: number }>;
  slaBreaches: number;
  avgResolutionHours: number | null;
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

  const totalCreated = stats.byStatus.reduce((sum, s) => sum + s.count, 0);
  const open = stats.byStatus
    .filter((s) => !['resolved', 'closed'].includes(s.status))
    .reduce((sum, s) => sum + s.count, 0);
  const closed = stats.byStatus
    .filter((s) => ['resolved', 'closed'].includes(s.status))
    .reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="container-max py-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">סטטיסטיקות פניות</h1>
        <p className="muted mt-1 text-sm">תמונת מצב של הפניות לאורך המערכת.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="סך הפניות" value={totalCreated} tone="neutral" />
        <KpiCard label="פתוחות" value={open} tone="info" />
        <KpiCard label="סגורות / נפתרו" value={closed} tone="success" />
        <KpiCard label="חריגות SLA" value={stats.slaBreaches} tone="danger" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold">לפי סטטוס</h2>
          <div className="mt-3 space-y-2">
            {stats.byStatus.length === 0 && <p className="muted text-sm">אין נתונים</p>}
            {stats.byStatus.map((row) => {
              const pct = totalCreated ? (row.count / totalCreated) * 100 : 0;
              const label = STATUS_META[row.status as keyof typeof STATUS_META]?.label || row.status;
              return (
                <BarRow key={row.status} label={label} value={row.count} pct={pct} />
              );
            })}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold">לפי דחיפות</h2>
          <div className="mt-3 space-y-2">
            {stats.byPriority.map((row) => {
              const pct = totalCreated ? (row.count / totalCreated) * 100 : 0;
              const label = PRIORITY_META[row.priority as keyof typeof PRIORITY_META]?.label || row.priority;
              return <BarRow key={row.priority} label={label} value={row.count} pct={pct} accent />;
            })}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="text-sm font-semibold">לפי קבוצה</h2>
          <div className="mt-3 space-y-2">
            {stats.byGroup
              .filter((r) => r.assigned_group)
              .sort((a, b) => b.count - a.count)
              .map((row) => {
                const pct = totalCreated ? (row.count / totalCreated) * 100 : 0;
                return (
                  <BarRow
                    key={row.assigned_group || 'none'}
                    label={groupLabel(row.assigned_group)}
                    value={row.count}
                    pct={pct}
                    accent
                  />
                );
              })}
            {stats.byGroup.find((r) => !r.assigned_group) && (
              <BarRow
                label="ללא ניתוב"
                value={stats.byGroup.find((r) => !r.assigned_group)?.count || 0}
                pct={
                  totalCreated
                    ? ((stats.byGroup.find((r) => !r.assigned_group)?.count || 0) / totalCreated) * 100
                    : 0
                }
                tone="warning"
              />
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="text-sm font-semibold">זמן טיפול ממוצע</h2>
          <p className="muted mt-1 text-sm">ממוצע השעות בין יצירת הפנייה לסימון כפתורה.</p>
          <div className="mt-3 text-3xl font-bold tabular-nums">
            {stats.avgResolutionHours == null ? '—' : `${stats.avgResolutionHours.toFixed(1)} שעות`}
          </div>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'info' | 'success' | 'danger' }) {
  const toneClass =
    tone === 'danger'
      ? 'text-rose-700 dark:text-rose-300'
      : tone === 'success'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'info'
      ? 'text-sky-700 dark:text-sky-300'
      : '';
  return (
    <Card>
      <div className="muted text-xs font-medium">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${toneClass}`}>{value}</div>
    </Card>
  );
}

function BarRow({
  label,
  value,
  pct,
  accent = false,
  tone,
}: {
  label: string;
  value: number;
  pct: number;
  accent?: boolean;
  tone?: 'warning';
}) {
  const barColor = tone === 'warning' ? 'bg-amber-400' : accent ? 'bg-indigo-500' : 'bg-neutral-700 dark:bg-neutral-200';
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="muted tabular-nums">{value}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
      </div>
    </div>
  );
}
