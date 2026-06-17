import { formatDateTime, formatRelative, humanizeIdentifier } from '../../utils/format.ts';
import {
  HISTORY_LABELS,
  groupLabel,
  JUSTIFICATION_META,
  PRIORITY_META,
  STATUS_META,
  type InquiryPriority,
  type JustificationDecision,
} from '../../utils/constants.ts';

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

/**
 * Turn a single history detail entry into a localized "label: value" pair.
 * Returns null for entries that should be hidden (e.g. a falsy flag). Keeps
 * raw English keys/values from ever leaking into the timeline.
 */
function renderDetail(
  key: string,
  value: unknown,
  displayNames: Record<string, string>,
): { label: string; text: string } | null {
  switch (key) {
    case 'from_group':
      return { label: 'מקבוצה', text: groupLabel(String(value)) };
    case 'to_group':
      return { label: 'לקבוצה', text: groupLabel(String(value)) };
    case 'assigned_user':
      return {
        label: 'מטפל',
        text: displayNames[String(value).toLowerCase()] || humanizeIdentifier(String(value)),
      };
    case 'route_to_manager':
      return value ? { label: 'ניתוב', text: 'ישירות למנהל' } : null;
    case 'justification': {
      const meta = JUSTIFICATION_META[String(value) as JustificationDecision];
      return { label: 'החלטה', text: meta ? meta.label : String(value) };
    }
    case 'from':
    case 'to': {
      const meta = PRIORITY_META[String(value) as InquiryPriority];
      return { label: key === 'from' ? 'מ' : 'ל', text: meta ? meta.label : String(value) };
    }
    case 'status': {
      const meta = STATUS_META[String(value) as keyof typeof STATUS_META];
      return { label: 'סטטוס', text: meta ? meta.label : String(value) };
    }
    case 'note':
      return { label: 'הערה', text: String(value) };
    default:
      if (typeof value === 'boolean') return { label: key, text: value ? 'כן' : 'לא' };
      return { label: key, text: String(value) };
  }
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
              .filter(([, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => renderDetail(k, v, displayNames))
              .filter((d): d is { label: string; text: string } => d !== null)
              .map((d) => `${d.label}: ${d.text}`)
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
