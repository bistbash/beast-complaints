import { formatDateTime, formatRelative, humanizeIdentifier } from '../../utils/format.ts';
import { HISTORY_LABELS, groupLabel } from '../../utils/constants.ts';

interface HistoryRow {
  id: string;
  action: string;
  actor: string;
  details?: Record<string, unknown>;
  created_at: string;
}

interface StatusTimelineProps {
  history: HistoryRow[];
  displayNames?: Record<string, string>;
}

/** Colour each history dot by the pipeline stage its action belongs to. */
const ACTION_COLOR: Record<string, string> = {
  created: '#94a3b8',
  routed: '#6366f1',
  rerouted: '#6366f1',
  assigned: '#6366f1',
  team_response_submitted: '#8b5cf6',
  manager_response_submitted: '#f59e0b',
  justification_set: '#f59e0b',
  closed: '#10b981',
  closing_email_sent: '#10b981',
  reopened: '#f59e0b',
  sla_breach: '#f43f5e',
};

function actionColor(action: string): string {
  return ACTION_COLOR[action] || '#6366f1';
}

export default function StatusTimeline({ history, displayNames = {} }: StatusTimelineProps) {
  if (!history.length) {
    return <p className="muted text-sm">אין רישומי היסטוריה.</p>;
  }
  return (
    <ol className="relative space-y-3 pr-4 pl-1">
      <div className="absolute right-1 top-1.5 bottom-1.5 w-px bg-neutral-200 dark:bg-neutral-800" aria-hidden />
      {history.map((h) => {
        const name = displayNames[h.actor?.toLowerCase()] || humanizeIdentifier(h.actor);
        const detailsStr = h.details && Object.keys(h.details).length
          ? Object.entries(h.details)
              .filter(([_, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => {
                const label =
                  k === 'from_group'
                    ? 'מקבוצה'
                    : k === 'to_group'
                      ? 'לקבוצה'
                      : k === 'assigned_user'
                        ? 'מטפל'
                        : k === 'route_to_manager'
                          ? 'ישירות למנהל'
                          : k;
                const value =
                  k === 'from_group' || k === 'to_group'
                    ? groupLabel(String(v))
                    : k === 'assigned_user'
                      ? displayNames[String(v).toLowerCase()] || humanizeIdentifier(String(v))
                      : String(v);
                return `${label}: ${value}`;
              })
              .join(' · ')
          : '';
        return (
          <li key={h.id} className="relative pr-4">
            <span
              className="absolute right-[-3px] top-2 h-2 w-2 rounded-full ring-2 ring-surface"
              style={{ background: actionColor(h.action) }}
              aria-hidden
            />
            <div className="text-sm">
              <span className="font-medium">{HISTORY_LABELS[h.action] || h.action}</span>
              <span className="muted"> · </span>
              <span className="muted">{name}</span>
            </div>
            {detailsStr && <p className="muted text-xs mt-0.5">{detailsStr}</p>}
            <time className="muted text-xs" title={formatDateTime(h.created_at)}>
              {formatRelative(h.created_at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
