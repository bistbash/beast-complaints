import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../utils/api.ts';
import Button from '../components/ui/Button.tsx';
import Card from '../components/ui/Card.tsx';
import StatusPill from '../components/ui/StatusPill.tsx';
import PriorityPill from '../components/ui/PriorityPill.tsx';
import LoadingScreen from '../components/layout/LoadingScreen.tsx';
import ErrorShell from '../components/layout/ErrorShell.tsx';
import MessageThread from '../components/inquiries/MessageThread.tsx';
import StatusTimeline from '../components/inquiries/StatusTimeline.tsx';
import RoutingDialog from '../components/inquiries/RoutingDialog.tsx';
import Avatar from '../components/ui/Avatar.tsx';
import useCapabilities from '../hooks/useCapabilities.ts';
import { formatDateTime, formatRelative, computeUrgency } from '../utils/format.ts';
import {
  STATUS,
  PRIORITY_META,
  groupLabel,
  type InquiryStatus,
  type InquiryPriority,
} from '../utils/constants.ts';

interface InquiryFull {
  inquiry_id: string;
  subject: string;
  description: string;
  status: InquiryStatus;
  priority: InquiryPriority;
  category: string | null;

  submitter_name: string;
  submitter_email: string;
  submitter_phone: string | null;
  submitter_relation: string | null;
  grade_level: string | null;
  class_name: number | null;
  department: string | null;
  entity: string | null;
  role: string | null;
  role_bislat: string | null;
  form_timestamp: string | null;

  created_at: string;
  routed_at: string | null;
  routed_by: string | null;
  assigned_group: string | null;
  assigned_user: string | null;

  team_response: string | null;
  team_response_at: string | null;
  team_response_by: string | null;

  manager_response: string | null;
  manager_response_at: string | null;
  manager_response_by: string | null;

  closed_at: string | null;
  closing_email_sent_at: string | null;
  last_activity_at: string;
  due_at: string | null;
}

interface DetailData {
  inquiry: InquiryFull;
  messages: Array<{
    id: string;
    inquiry_id: string;
    author: string;
    author_name: string | null;
    content: string;
    message_type: 'comment' | 'system' | 'routing' | 'status_change' | 'team_response' | 'manager_response';
    created_at: string;
  }>;
  history: Array<{
    id: string;
    inquiry_id: string;
    action: string;
    actor: string;
    details: Record<string, unknown>;
    created_at: string;
  }>;
  displayNames: Record<string, string>;
}

export default function InquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { capabilities } = useCapabilities();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [showRouting, setShowRouting] = useState(false);
  const [teamDraft, setTeamDraft] = useState('');
  const [managerDraft, setManagerDraft] = useState('');

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/inquiries/${id}`);
      if (res.status >= 400) {
        setError(res.data?.error || 'הפנייה לא נמצאה');
        setData(null);
      } else {
        setData(res.data);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'טעינת הפנייה נכשלה');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function postComment(content: string) {
    if (!id) return;
    await api.post(`/api/inquiries/${id}/messages`, { content });
    await refresh();
  }

  async function submitTeamResponse() {
    if (!id || !teamDraft.trim()) return;
    setActing(true);
    try {
      await api.post(`/api/inquiries/${id}/team-response`, { content: teamDraft.trim() });
      setTeamDraft('');
      await refresh();
    } finally {
      setActing(false);
    }
  }

  async function submitManagerResponse() {
    if (!id || !managerDraft.trim()) return;
    setActing(true);
    try {
      await api.post(`/api/inquiries/${id}/manager-response`, { content: managerDraft.trim() });
      setManagerDraft('');
      await refresh();
    } finally {
      setActing(false);
    }
  }

  async function changePriority(priority: InquiryPriority) {
    if (!id) return;
    setActing(true);
    try {
      await api.post(`/api/inquiries/${id}/priority`, { priority });
      await refresh();
    } finally {
      setActing(false);
    }
  }

  async function reopen() {
    if (!id) return;
    if (!confirm('לפתוח את הפנייה מחדש?')) return;
    setActing(true);
    try {
      await api.post(`/api/inquiries/${id}/reopen`, { note: 'הפנייה נפתחה מחדש על ידי מנהל' });
      await refresh();
    } finally {
      setActing(false);
    }
  }

  if (loading && !data) return <LoadingScreen message="טוען פנייה…" />;
  if (error || !data) {
    return (
      <ErrorShell
        title="לא ניתן להציג את הפנייה"
        description={error || 'הפנייה לא נמצאה'}
        actionLabel="חזרה לתיבת הפניות"
        actionTo="/inbox"
      />
    );
  }

  const { inquiry, messages, history, displayNames } = data;
  const urgency = computeUrgency(inquiry.created_at, inquiry.due_at, inquiry.status);
  const isAssignee = capabilities?.email?.toLowerCase() === inquiry.assigned_user?.toLowerCase();
  const canWriteTeamResponse =
    inquiry.status === STATUS.ROUTED &&
    (isAssignee || capabilities?.isKeva || capabilities?.isAdmin || capabilities?.isNavigator);
  const canWriteManagerResponse =
    inquiry.status === STATUS.AWAITING_MANAGER && !!capabilities?.isManager;
  const isOpen = inquiry.status !== STATUS.CLOSED;

  return (
    <div className="container-max py-6 md:py-8">
      <button onClick={() => navigate(-1)} className="muted mb-3 inline-flex items-center gap-1 text-sm hover:underline">
        ← חזור
      </button>

      <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
        <main className="space-y-5">
          {/* === Inquiry overview === */}
          <Card className={urgency === 'critical' ? 'urgency-critical' : urgency === 'warning' ? 'urgency-warning' : ''}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold leading-tight">{inquiry.subject}</h1>
                <div className="muted mt-1 text-xs">
                  הוגשה {formatRelative(inquiry.created_at)} · {formatDateTime(inquiry.created_at)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={inquiry.status} />
                <PriorityPill priority={inquiry.priority} />
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-surface-elevated p-4">
              <div className="muted mb-2 text-xs font-semibold uppercase tracking-wide">פנייה מקורית</div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{inquiry.description}</p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
              {isOpen && capabilities?.canRoute && (
                <Button variant="accent" size="sm" onClick={() => setShowRouting(true)} disabled={acting}>
                  {inquiry.assigned_group ? 'נתב מחדש' : 'נתב פנייה'}
                </Button>
              )}
              {!isOpen && capabilities?.isManager && (
                <Button variant="ghost" size="sm" onClick={reopen} disabled={acting}>
                  פתח מחדש
                </Button>
              )}
            </div>
          </Card>

          {/* === Team Response section === */}
          {(canWriteTeamResponse || inquiry.team_response) && (
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">התייחסות צוות</h2>
                {inquiry.team_response_at && (
                  <span className="muted text-xs">
                    נכתבה {formatRelative(inquiry.team_response_at)} ע"י{' '}
                    {displayNames[inquiry.team_response_by?.toLowerCase() || ''] ||
                      inquiry.team_response_by?.split('@')[0]}
                  </span>
                )}
              </div>
              {inquiry.team_response ? (
                <p className="mt-3 whitespace-pre-wrap rounded-xl border border-violet-200 bg-violet-50/40 p-3 text-sm leading-relaxed dark:border-violet-900 dark:bg-violet-950/20">
                  {inquiry.team_response}
                </p>
              ) : (
                <p className="muted mt-2 text-sm">אין עדיין התייחסות צוות.</p>
              )}

              {canWriteTeamResponse && !inquiry.team_response && (
                <div className="mt-4 space-y-2">
                  <textarea
                    className="textarea"
                    value={teamDraft}
                    onChange={(e) => setTeamDraft(e.target.value)}
                    placeholder="כתוב את ההתייחסות של הצוות לפנייה — היא תועבר להחלטת המנהל…"
                    rows={5}
                  />
                  <div className="flex items-center justify-between">
                    <p className="muted text-xs">לאחר שליחה, הפנייה תועבר לאישור מנהל.</p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={submitTeamResponse}
                      loading={acting}
                      disabled={!teamDraft.trim()}
                    >
                      שלח התייחסות צוות
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* === Manager Response section === */}
          {(canWriteManagerResponse || inquiry.manager_response) && (
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">התייחסות מנהל / החלטה סופית</h2>
                {inquiry.manager_response_at && (
                  <span className="muted text-xs">
                    נכתבה {formatRelative(inquiry.manager_response_at)} ע"י{' '}
                    {displayNames[inquiry.manager_response_by?.toLowerCase() || ''] ||
                      inquiry.manager_response_by?.split('@')[0]}
                  </span>
                )}
              </div>
              {inquiry.manager_response ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{inquiry.manager_response}</p>
                  {inquiry.closing_email_sent_at && (
                    <div className="muted mt-3 flex items-center gap-1 text-xs">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M5 12l5 5L20 7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      מייל סגירה נשלח לפונה ב-{formatDateTime(inquiry.closing_email_sent_at)}
                    </div>
                  )}
                </div>
              ) : (
                <p className="muted mt-2 text-sm">ממתינה להתייחסות מנהל.</p>
              )}

              {canWriteManagerResponse && !inquiry.manager_response && (
                <div className="mt-4 space-y-2">
                  {inquiry.team_response && (
                    <div className="muted rounded-md bg-neutral-50 p-2 text-xs dark:bg-neutral-900/40">
                      הצוות כתב התייחסות — קרא אותה לפני שכותב/ת את ההחלטה הסופית.
                    </div>
                  )}
                  <textarea
                    className="textarea"
                    value={managerDraft}
                    onChange={(e) => setManagerDraft(e.target.value)}
                    placeholder={'כתוב את ההחלטה הסופית — היא תישלח לפונה כתשובה רשמית בדוא"ל…'}
                    rows={6}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <p className="muted text-xs">לאחר שליחה, הפנייה תיסגר ויישלח מייל לפונה.</p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={submitManagerResponse}
                      loading={acting}
                      disabled={!managerDraft.trim()}
                    >
                      סיים וסגור פנייה
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* === Discussion / comments === */}
          <Card>
            <h2 className="text-sm font-semibold">שיח פנימי</h2>
            <div className="mt-3">
              <MessageThread
                messages={messages}
                displayNames={displayNames}
                currentUserEmail={capabilities?.email}
                onPost={isOpen ? postComment : undefined}
                disabled={acting}
              />
            </div>
          </Card>
        </main>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* Submitter card */}
          <Card>
            <h3 className="text-sm font-semibold">פרטי הפונה</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Avatar name={inquiry.submitter_name} size={32} />
                <div>
                  <div className="font-medium">{inquiry.submitter_name}</div>
                  {inquiry.submitter_relation && (
                    <div className="muted text-xs">
                      {inquiry.submitter_relation === 'parent' ? 'הורה' :
                        inquiry.submitter_relation === 'guardian' ? 'אפוטרופוס' :
                        inquiry.submitter_relation === 'student' ? 'תלמיד/ה' :
                        inquiry.submitter_relation === 'staff' ? 'איש צוות' :
                        inquiry.submitter_relation}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-subtle pt-3">
                <dt className="muted">מייל</dt>
                <dd className="font-mono text-xs" dir="ltr">{inquiry.submitter_email}</dd>
              </div>
              {inquiry.submitter_phone && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="muted">טלפון</dt>
                  <dd className="font-mono text-xs" dir="ltr">{inquiry.submitter_phone}</dd>
                </div>
              )}
              {inquiry.grade_level && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="muted">שכבה</dt>
                  <dd className="font-medium">{inquiry.grade_level}</dd>
                </div>
              )}
              {inquiry.class_name != null && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="muted">כיתה</dt>
                  <dd className="font-medium">{inquiry.class_name}</dd>
                </div>
              )}
              {inquiry.department && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="muted">מחלקה</dt>
                  <dd className="font-medium">{inquiry.department}</dd>
                </div>
              )}
              {inquiry.entity && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="muted">גורם</dt>
                  <dd className="font-medium">{inquiry.entity}</dd>
                </div>
              )}
              {inquiry.role_bislat && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="muted">תפקיד</dt>
                  <dd className="font-medium">{inquiry.role_bislat}</dd>
                </div>
              )}
            </dl>
          </Card>

          {/* Routing card */}
          <Card>
            <h3 className="text-sm font-semibold">שיוך וטיפול</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="muted">קבוצה</dt>
                <dd className="font-medium">{groupLabel(inquiry.assigned_group)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="muted">מטפל</dt>
                <dd className="font-medium">
                  {inquiry.assigned_user
                    ? displayNames[inquiry.assigned_user.toLowerCase()] || inquiry.assigned_user
                    : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-subtle pt-3">
                <dt className="muted">יעד SLA</dt>
                <dd className="font-medium" title={formatDateTime(inquiry.due_at)}>
                  {formatRelative(inquiry.due_at)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="muted">עדכון אחרון</dt>
                <dd className="font-medium">{formatRelative(inquiry.last_activity_at)}</dd>
              </div>
              {inquiry.closed_at && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="muted">נסגרה ב-</dt>
                  <dd className="font-medium">{formatDateTime(inquiry.closed_at)}</dd>
                </div>
              )}
            </dl>
          </Card>

          {capabilities?.canRoute && isOpen && (
            <Card>
              <h3 className="text-sm font-semibold">פעולות מהירות</h3>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="field-label">דחיפות</label>
                  <select
                    className="select"
                    value={inquiry.priority}
                    onChange={(e) => changePriority(e.target.value as InquiryPriority)}
                    disabled={acting}
                  >
                    {Object.entries(PRIORITY_META).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <h3 className="text-sm font-semibold">היסטוריה</h3>
            <div className="mt-3">
              <StatusTimeline history={history} displayNames={displayNames} />
            </div>
          </Card>
        </aside>
      </div>

      <RoutingDialog
        open={showRouting}
        onClose={() => setShowRouting(false)}
        inquiryId={inquiry.inquiry_id}
        currentGroup={inquiry.assigned_group}
        capabilities={capabilities}
        onRouted={refresh}
      />
    </div>
  );
}
