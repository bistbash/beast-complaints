import { useEffect, useState } from 'react';
import Modal from '../ui/Modal.tsx';
import Button from '../ui/Button.tsx';
import api from '../../utils/api.ts';
import { groupLabel } from '../../utils/constants.ts';
import type { Capabilities } from '../../hooks/useCapabilities.ts';

interface Member {
  username: string;
  email: string | null;
  displayName: string | null;
  suggestedGroup?: string | null;
  isManager?: boolean;
}

interface Manager {
  username: string;
  email: string | null;
  displayName: string | null;
}

interface RoutingDialogProps {
  open: boolean;
  onClose: () => void;
  inquiryId: string;
  currentGroup?: string | null;
  capabilities: Capabilities | null;
  onRouted: () => void;
}

type Mode = 'team' | 'manager';

export default function RoutingDialog({
  open,
  onClose,
  inquiryId,
  currentGroup,
  capabilities,
  onRouted,
}: RoutingDialogProps) {
  const [mode, setMode] = useState<Mode>('team');
  const [group, setGroup] = useState(currentGroup || '');
  const [members, setMembers] = useState<Member[]>([]);
  const [membersWarning, setMembersWarning] = useState<string | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [assignedUser, setAssignedUser] = useState('');
  const [assignedUserQuery, setAssignedUserQuery] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowedGroups = capabilities?.manageableGroups || [];
  const canRouteToManager = !!(capabilities?.isAdmin || capabilities?.isNavigator);

  useEffect(() => {
    if (!open) return;
    setMode('team');
    setGroup(currentGroup || (allowedGroups.length === 1 ? allowedGroups[0] : ''));
    setGroupQuery(currentGroup ? groupLabel(currentGroup) : allowedGroups.length === 1 ? groupLabel(allowedGroups[0]) : '');
    setAssignedUser('');
    setAssignedUserQuery('');
    setError(null);
  }, [open, currentGroup, allowedGroups]);

  useEffect(() => {
    if (mode !== 'manager') return;
    api
      .get('/api/inquiries/lookup/managers')
      .then((res) => setManagers(res.data?.managers || []))
      .catch(() => setManagers([]));
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    const params = group ? { group } : undefined;
    api
      .get('/api/inquiries/lookup/members', params ? { params } : undefined)
      .then((res) => {
        if (cancelled) return;
        setMembers(res.data?.members || []);
        setMembersWarning(res.data?.warning || null);
      })
      .catch(() => {
        if (cancelled) return;
        setMembers([]);
        setMembersWarning('טעינת חברי הקבוצה נכשלה');
      });
    return () => {
      cancelled = true;
    };
  }, [group, mode]);

  function normalizeText(value: string): string {
    return value.trim().toLowerCase();
  }

  function memberValue(m: Member): string {
    const name = m.displayName || 'Display Name';
    const identity = m.email || `${m.username}@local`;
    return `${name} (${identity})`;
  }

  function onGroupInput(value: string) {
    setGroupQuery(value);
    const v = normalizeText(value);
    const match = allowedGroups.find((g) => normalizeText(g) === v || normalizeText(groupLabel(g)) === v);
    setGroup(match || '');
    if (!match) {
      setAssignedUser('');
      setAssignedUserQuery('');
    }
  }

  function onMemberInput(value: string) {
    setAssignedUserQuery(value);
    const v = normalizeText(value);
    const match = members.find((m) => normalizeText(memberValue(m)) === v);
    if (!match) {
      setAssignedUser('');
      return;
    }
    const identity = match.email || `${match.username}@local`;
    setAssignedUser(identity);
    if (!group && match.suggestedGroup) {
      setGroup(match.suggestedGroup);
      setGroupQuery(groupLabel(match.suggestedGroup));
    }
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'manager') {
        if (!assignedUser) {
          setError('בחר מנהל');
          return;
        }
        await api.post(`/api/inquiries/${inquiryId}/route`, {
          assignedUser,
          routeToManager: true,
        });
      } else {
        if (!group && !assignedUser) {
          setError('יש לבחור קבוצה או חבר צוות');
          return;
        }
        await api.post(`/api/inquiries/${inquiryId}/route`, {
          group: group || undefined,
          assignedUser: assignedUser || null,
        });
      }
      onRouted();
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'הניתוב נכשל');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ניתוב פנייה"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            ביטול
          </Button>
          <Button variant="primary" size="sm" onClick={submit} loading={submitting}>
            נתב
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {canRouteToManager && (
          <div className="flex gap-1 rounded-lg border border-subtle bg-surface-elevated p-1">
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                mode === 'team' ? 'bg-surface shadow-sm' : 'text-neutral-500'
              }`}
              onClick={() => setMode('team')}
            >
              ניתוב לצוות
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                mode === 'manager' ? 'bg-surface shadow-sm' : 'text-neutral-500'
              }`}
              onClick={() => setMode('manager')}
            >
              ישירות למנהל
            </button>
          </div>
        )}

        {mode === 'team' && (
          <>
            <div>
              <label className="field-label">קבוצה יעד {capabilities?.isKeva && '(רק קבוצות שאתה חבר בהן)'}</label>
              <input
                list="routing-group-options"
                className="input"
                value={groupQuery}
                onChange={(e) => onGroupInput(e.target.value)}
                placeholder="התחל להקליד קבוצה…"
              />
              <datalist id="routing-group-options">
                {allowedGroups.map((g) => (
                  <option key={g} value={groupLabel(g)} />
                ))}
              </datalist>
              {!allowedGroups.length && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  אין לך הרשאה לנתב לקבוצות. צור קשר עם המנהל.
                </p>
              )}
            </div>
            <div>
              <label className="field-label">חבר צוות (אופציונלי)</label>
              <input
                list="routing-member-options"
                className="input"
                value={assignedUserQuery}
                onChange={(e) => onMemberInput(e.target.value)}
                placeholder={group ? 'התחל להקליד חבר צוות…' : 'התחל להקליד חבר צוות מכל הקבוצות…'}
              />
              <datalist id="routing-member-options">
                {members.map((m) => (
                  <option key={m.email || m.username} value={memberValue(m)} />
                ))}
              </datalist>
              {membersWarning ? (
                <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  {membersWarning}
                </p>
              ) : members.length === 0 ? (
                <p className="mt-1 text-xs text-neutral-500">
                  {group ? 'לא נמצאו חברי צוות בקבוצה זו ב-AD.' : 'לא נמצאו משתמשים זמינים לניתוב.'}
                </p>
              ) : (
                <p className="field-hint">
                  {group
                    ? 'ללא שיוך — כל הצוות יראה את הפנייה. בחירת חבר ספציפי תשייך לטיפול אישי.'
                    : 'אפשר לבחור משתמש גם בלי לבחור קבוצה — הקבוצה תיבחר אוטומטית לפי המשתמש שנבחר.'}
                </p>
              )}
            </div>
          </>
        )}

        {mode === 'manager' && (
          <div>
            <label className="field-label">מנהל</label>
            <select className="select" value={assignedUser} onChange={(e) => setAssignedUser(e.target.value)}>
              <option value="">— בחר מנהל —</option>
              {managers.map((m) => (
                <option key={m.username} value={m.email || `${m.username}@local`}>
                  {m.displayName || 'Display Name'}
                </option>
              ))}
            </select>
            <p className="field-hint">
              הפנייה תועבר ישירות להחלטת המנהל ותדלג על שלב התייחסות הצוות.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
