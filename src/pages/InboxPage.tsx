import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api.ts';
import InquiryCard, { type InquirySummary } from '../components/inquiries/InquiryCard.tsx';
import InquiryFilters, { type FilterValues } from '../components/inquiries/InquiryFilters.tsx';
import { PipelineLegend } from '../components/inquiries/Pipeline.tsx';
import Empty from '../components/ui/Empty.tsx';
import { GROUP_LABELS, STATUS } from '../utils/constants.ts';
import useCapabilities from '../hooks/useCapabilities.ts';

const EMPTY_FILTERS: FilterValues = { search: '', status: '', priority: '', group: '' };

/**
 * Scope = which slice of inquiries to fetch from the server.
 * - `all`              : every open inquiry the user is allowed to see
 * - `mine_assigned`    : only inquiries assigned to the current user
 * - `unrouted`         : inquiries waiting for the navigator (status = new)
 * - `awaiting_manager` : inquiries waiting for a manager response
 */
type Scope = 'all' | 'mine_assigned' | 'unrouted' | 'awaiting_manager' | 'overdue';

interface InboxPageProps {
  /** "inbox" = open inquiries (with scope tabs). "closed" = closed inquiries. */
  view?: 'inbox' | 'closed';
}

export default function InboxPage({ view = 'inbox' }: InboxPageProps) {
  const isClosed = view === 'closed';
  const [items, setItems] = useState<InquirySummary[]>([]);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterValues>(EMPTY_FILTERS);
  const [groups, setGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [listTotal, setListTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [params, setParams] = useSearchParams();
  const { capabilities } = useCapabilities();

  /** Scope counts — fetched once on mount and refreshed when items change shape. */
  const [scopeCounts, setScopeCounts] = useState<Record<Scope, number>>({
    all: 0,
    mine_assigned: 0,
    unrouted: 0,
    awaiting_manager: 0,
    overdue: 0,
  });

  const scope: Scope = (params.get('scope') as Scope) || 'all';

  useEffect(() => {
    api
      .get('/api/inquiries/lookup/groups')
      .then((res) => setGroups(res.data?.groups || []))
      .catch(() => setGroups([]));
  }, []);

  useEffect(() => {
    const initial: FilterValues = { ...EMPTY_FILTERS };
    initial.search = params.get('q') || '';
    initial.status = (params.get('status') as FilterValues['status']) || '';
    initial.priority = (params.get('priority') as FilterValues['priority']) || '';
    initial.group = params.get('group') || '';
    setFilters(initial);
  }, [params]);

  // Fetch the main list (respects scope + filters).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const q: Record<string, string> = {};
    if (isClosed) {
      q.view = 'closed';
    } else if (scope === 'mine_assigned') {
      q.view = 'mine_assigned';
    } else if (scope === 'unrouted') {
      q.view = 'unrouted';
    } else if (scope === 'awaiting_manager') {
      q.view = 'awaiting_manager';
    } else if (scope === 'overdue') {
      q.view = 'overdue';
    } else {
      q.view = 'open';
    }

    if (filters.search) q.q = filters.search;
    if (filters.status) q.status = filters.status;
    if (filters.priority) q.priority = filters.priority;
    if (filters.group) q.group = filters.group;

    api
      .get('/api/inquiries', { params: q })
      .then((res) => {
        if (cancelled) return;
        setItems(res.data?.inquiries || []);
        setDisplayNames(res.data?.displayNames || {});
        setListTotal(res.data?.pagination?.total ?? res.data?.inquiries?.length ?? 0);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'טעינת פניות נכשלה');
        setItems([]);
        setDisplayNames({});
        setListTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, scope, isClosed, reloadKey]);

  // Refresh scope counts whenever items change (cheap because we fetch counts together).
  useEffect(() => {
    if (isClosed) return;
    let cancelled = false;

    const queries: Array<[Scope, Record<string, string>]> = [
      ['all', { view: 'open' }],
      ['mine_assigned', { view: 'mine_assigned' }],
      ['overdue', { view: 'overdue' }],
    ];
    if (capabilities?.canRoute) queries.push(['unrouted', { view: 'unrouted' }]);
    if (capabilities?.isManager || capabilities?.canViewAll)
      queries.push(['awaiting_manager', { view: 'awaiting_manager' }]);

    Promise.all(
      queries.map(([key, q]) =>
        api
          .get('/api/inquiries', { params: { ...q, limit: 1 } })
          .then((res) => [key, res.data?.pagination?.total ?? 0] as const)
          .catch(() => [key, 0] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<Scope, number> = {
        all: 0,
        mine_assigned: 0,
        unrouted: 0,
        awaiting_manager: 0,
        overdue: 0,
      };
      for (const [k, v] of results) next[k] = v;
      setScopeCounts(next);
    });

    return () => {
      cancelled = true;
    };
  }, [isClosed, capabilities, items.length]);

  function updateFilters(next: FilterValues) {
    setFilters(next);
    const p = new URLSearchParams(params);
    p.delete('q');
    p.delete('status');
    p.delete('priority');
    p.delete('group');
    if (next.search) p.set('q', next.search);
    if (next.status) p.set('status', next.status);
    if (next.priority) p.set('priority', next.priority);
    if (next.group) p.set('group', next.group);
    setParams(p, { replace: true });
  }

  function changeScope(next: Scope) {
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('scope');
    else p.set('scope', next);
    setParams(p, { replace: true });
  }

  const stats = useMemo(() => {
    const urgent = items.filter((i) => i.priority === 'urgent' || i.priority === 'high').length;
    return { urgent };
  }, [items]);

  const pageTitle = isClosed ? 'פניות סגורות' : 'פניות פתוחות';
  const pageSubtitle = isClosed
    ? 'פניות שהושלם הטיפול בהן'
    : capabilities?.canViewAll
      ? 'כל הפניות הפעילות במערכת'
      : 'פניות שמשויכות אליך או לקבוצות שלך';

  const scopeChips: Array<{ id: Scope; label: string; show: boolean; tone?: 'danger' }> = [
    { id: 'all', label: 'הכל', show: true },
    { id: 'mine_assigned', label: 'משויכות אליי', show: true },
    { id: 'unrouted', label: 'תור ניתוב', show: !!capabilities?.canRoute },
    {
      id: 'awaiting_manager',
      label: 'ממתינות למנהל',
      show: !!(capabilities?.isManager || capabilities?.canViewAll),
    },
    { id: 'overdue', label: 'חורגות מ-SLA', show: true, tone: 'danger' },
  ];

  return (
    <div className="container-max py-6 md:py-8">
      <header className="mb-5 overflow-hidden rounded-2xl border border-subtle bg-gradient-to-l from-indigo-50/60 via-surface to-surface p-5 dark:from-indigo-950/30 dark:via-surface dark:to-surface">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
            <p className="muted mt-1 text-sm">{pageSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isClosed && <KpiChip label="פתוחות" value={scopeCounts.all} tone="neutral" />}
            {isClosed && <KpiChip label="סגורות" value={listTotal} tone="neutral" />}
            {stats.urgent > 0 && <KpiChip label="דחופות" value={stats.urgent} tone="danger" />}
          </div>
        </div>
        <div className="mt-4 border-t border-subtle/70 pt-3">
          <PipelineLegend />
        </div>
      </header>

      {!isClosed && (
        <div className="mb-4 -mx-1 flex flex-wrap items-center gap-1.5 px-1">
          {scopeChips
            .filter((c) => c.show)
            .map((chip) => {
              const isActive = scope === chip.id;
              const count = scopeCounts[chip.id];
              const isDanger = chip.tone === 'danger' && count > 0;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => changeScope(chip.id)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                      : isDanger
                        ? 'border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200'
                        : 'border-subtle bg-surface text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-white'
                  }`}
                  aria-pressed={isActive}
                >
                  <span>{chip.label}</span>
                  <span
                    className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums ${
                      isActive
                        ? 'bg-white/20 text-white dark:bg-neutral-900/20 dark:text-neutral-900'
                        : isDanger
                          ? 'bg-rose-200/70 text-rose-800 dark:bg-rose-900/60 dark:text-rose-100'
                          : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
        </div>
      )}

      <div className="mb-5">
        <InquiryFilters
          value={filters}
          groups={groups}
          groupLabels={GROUP_LABELS}
          onChange={updateFilters}
          onReset={() => updateFilters(EMPTY_FILTERS)}
        />
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="card">
              <div className="skeleton h-5 w-2/3" />
              <div className="skeleton mt-2 h-3 w-full" />
              <div className="skeleton mt-1 h-3 w-3/4" />
              <div className="skeleton mt-4 h-4 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="btn btn-ghost btn-sm border-rose-300 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-950/60"
          >
            נסה שוב
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <Empty
          icon={
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          title="אין פניות להצגה"
          description={
            isClosed
              ? 'עדיין לא נסגרו פניות.'
              : scope === 'unrouted'
                ? 'אין פניות חדשות שממתינות לניתוב.'
                : scope === 'awaiting_manager'
                  ? 'אין פניות שממתינות להתייחסות מנהל.'
                  : scope === 'overdue'
                    ? 'אין פניות שחרגו מיעד הטיפול — כל הכבוד!'
                    : scope === 'mine_assigned'
                      ? 'אין פניות שמשויכות אליך כרגע.'
                      : 'כשהורים יגישו פניות, הן יופיעו כאן.'
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((inquiry) => (
            <InquiryCard key={inquiry.inquiry_id} inquiry={inquiry} displayNames={displayNames} />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'warning' | 'danger' | 'info';
}) {
  const toneClass =
    tone === 'danger'
      ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900'
      : tone === 'warning'
        ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900'
        : tone === 'info'
          ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900'
          : 'bg-neutral-50 text-neutral-700 border-neutral-200 dark:bg-neutral-800/60 dark:text-neutral-200 dark:border-neutral-700';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>
      <span>{label}</span>
      <span className="text-sm font-bold tabular-nums">{value}</span>
    </span>
  );
}
