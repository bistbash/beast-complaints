import { Link } from 'react-router-dom';
import PriorityPill from '../ui/PriorityPill.tsx';
import Avatar from '../ui/Avatar.tsx';
import { CompactPipeline } from './Pipeline.tsx';
import { computeUrgency, formatRelative } from '../../utils/format.ts';
import { computePipeline } from '../../utils/pipeline.ts';
import {
  groupLabel,
  JUSTIFICATION_META,
  type InquiryStatus,
  type InquiryPriority,
  type JustificationDecision,
} from '../../utils/constants.ts';

export interface InquirySummary {
  inquiry_id: string;
  subject: string;
  description: string;
  status: InquiryStatus;
  priority: InquiryPriority;
  category: string | null;

  submitter_name: string;
  submitter_email: string;
  submitter_relation?: string | null;
  grade_level?: string | null;
  class_name?: number | null;

  created_at: string;
  assigned_group: string | null;
  assigned_user: string | null;
  last_activity_at: string;
  due_at: string | null;
  justification?: JustificationDecision | null;
}

interface InquiryCardProps {
  inquiry: InquirySummary;
  displayNames?: Record<string, string>;
}

export default function InquiryCard({ inquiry, displayNames = {} }: InquiryCardProps) {
  const urgency = computeUrgency(inquiry.created_at, inquiry.due_at, inquiry.status);
  const urgencyClass =
    urgency === 'critical' ? 'urgency-critical' : urgency === 'warning' ? 'urgency-warning' : '';

  const pipe = computePipeline({ status: inquiry.status, assigned_group: inquiry.assigned_group });

  const assigneeName = inquiry.assigned_user
    ? displayNames[inquiry.assigned_user.toLowerCase()] || inquiry.assigned_user
    : null;

  return (
    <Link to={`/inquiries/${inquiry.inquiry_id}`} className="block rounded-2xl">
      <article className={`card card-hover card-interactive fade-in-up flex flex-col ${urgencyClass}`}>
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-base font-semibold leading-snug">{inquiry.subject}</h3>
            <p className="muted mt-1 line-clamp-2 text-sm leading-relaxed">{inquiry.description}</p>
          </div>
          <PriorityPill priority={inquiry.priority} size="sm" />
        </header>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {inquiry.assigned_group && (
            <span className="pill bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-900">
              {groupLabel(inquiry.assigned_group)}
            </span>
          )}
          {assigneeName && (
            <span className="pill pill-neutral">
              <span className="muted">מטפל:</span> {assigneeName}
            </span>
          )}
          {inquiry.category && <span className="pill pill-neutral">{inquiry.category}</span>}
          {inquiry.justification && (
            <span
              className={
                JUSTIFICATION_META[inquiry.justification].tone === 'warning'
                  ? 'pill border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'pill pill-neutral'
              }
              title={JUSTIFICATION_META[inquiry.justification].description}
            >
              {JUSTIFICATION_META[inquiry.justification].label}
            </span>
          )}
        </div>

        {/* Pipeline tracker — at-a-glance progress through the lifecycle. */}
        <div className="mt-4">
          <CompactPipeline value={pipe} />
        </div>

        <footer className="mt-4 flex items-center justify-between gap-3 border-t border-subtle pt-3 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={inquiry.submitter_name} size={24} />
            <div className="min-w-0">
              <div className="truncate text-neutral-700 dark:text-neutral-300">{inquiry.submitter_name}</div>
              {inquiry.grade_level && (
                <div className="muted truncate text-[11px]">
                  {inquiry.grade_level}
                  {inquiry.class_name ? ` · כיתה ${inquiry.class_name}` : ''}
                </div>
              )}
            </div>
          </div>
          <div className="muted whitespace-nowrap">{formatRelative(inquiry.last_activity_at || inquiry.created_at)}</div>
        </footer>
      </article>
    </Link>
  );
}
