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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowedGroups = capabilities?.manageableGroups || [];
  const canRouteToManager = !!(capabilities?.isAdmin || capabilities?.isNavigator);

  useEffect(() => {
    if (!open) return;
    setMode('team');
    setGroup(currentGroup || (allowedGroups.length === 1 ? allowedGroups[0] : ''));
    setAssignedUser('');
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
    if (!group) {
      setMembers([]);
      setMembersWarning(null);
      return;
    }
    let cancelled = false;
    api
      .get('/api/inquiries/lookup/members', { params: { group } })
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
  }, [group]);

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
              <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">— בחר קבוצה —</option>
                {allowedGroups.map((g) => (
                  <option key={g} value={g}>
                    {groupLabel(g)}
                  </option>
                ))}
              </select>
              {!allowedGroups.length && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  אין לך הרשאה לנתב לקבוצות. צור קשר עם המנהל.
                </p>
              )}
            </div>
            <div>
              <label className="field-label">חבר צוות (אופציונלי)</label>
              <select
                className="select"
                value={assignedUser}
                onChange={(e) => setAssignedUser(e.target.value)}
                disabled={!group}
              >
                <option value="">— ללא שיוך אישי —</option>
                {members.map((m) => (
                  <option key={m.username} value={m.email || `${m.username}@local`}>
                    {m.displayName || m.username}
                    {m.isManager ? ' (מנהל)' : ''}
                  </option>
                ))}
              </select>
              {membersWarning ? (
                <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  {membersWarning}
                </p>
              ) : group && members.length === 0 ? (
                <p className="mt-1 text-xs text-neutral-500">
                  לא נמצאו חברי צוות בקבוצה זו ב-AD.
                </p>
              ) : (
                <p className="field-hint">
                  ללא שיוך — כל הצוות יראה את הפנייה. בחירת חבר ספציפי תשייך לטיפול אישי.
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
                  {m.displayName || m.username}
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
