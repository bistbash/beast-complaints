import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal.tsx';
import Button from '../ui/Button.tsx';
import UserSearchInput, { type UserSearchOption } from '../shared/UserSearchInput.tsx';
import api from '../../utils/api.ts';
import { groupLabel } from '../../utils/constants.ts';
import type { Capabilities } from '../../hooks/useCapabilities.ts';

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
  const [members, setMembers] = useState<UserSearchOption[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersWarning, setMembersWarning] = useState<string | null>(null);
  const [managers, setManagers] = useState<UserSearchOption[]>([]);
  const [managersLoading, setManagersLoading] = useState(false);
  const [assignedUser, setAssignedUser] = useState('');
  const [assignedUserDisplayName, setAssignedUserDisplayName] = useState('');
  const [assignedUserAvatarUrl, setAssignedUserAvatarUrl] = useState<string | null>(null);
  const [groupQuery, setGroupQuery] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const allowedGroups = capabilities?.manageableGroups || [];
  const canRouteToManager = !!(capabilities?.isAdmin || capabilities?.isNavigator);

  useEffect(() => {
    if (!open) return;
    setMode('team');
    setGroup(currentGroup || (allowedGroups.length === 1 ? allowedGroups[0] : ''));
    setGroupQuery(currentGroup ? groupLabel(currentGroup) : allowedGroups.length === 1 ? groupLabel(allowedGroups[0]) : '');
    clearAssignee();
    setError(null);
  }, [open, currentGroup, allowedGroups]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) {
        setGroupOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (mode !== 'manager') return;
    setManagersLoading(true);
    api
      .get('/api/inquiries/lookup/managers')
      .then((res) => setManagers(res.data?.managers || []))
      .catch(() => setManagers([]))
      .finally(() => setManagersLoading(false));
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    setMembersLoading(true);
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
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [group, mode]);

  function clearAssignee() {
    setAssignedUser('');
    setAssignedUserDisplayName('');
    setAssignedUserAvatarUrl(null);
  }

  function normalizeText(value: string): string {
    return value.trim().toLowerCase();
  }

  const filteredGroups = useMemo(() => {
    const q = normalizeText(groupQuery);
    if (!q) return allowedGroups.map((g) => ({ key: g, label: groupLabel(g) }));
    return allowedGroups
      .map((g) => ({ key: g, label: groupLabel(g) }))
      .filter((g) => normalizeText(g.key) === q || normalizeText(g.label).includes(q));
  }, [groupQuery, allowedGroups]);

  function onGroupInput(value: string) {
    setGroupQuery(value);
    const v = normalizeText(value);
    const match = allowedGroups.find((g) => normalizeText(g) === v || normalizeText(groupLabel(g)) === v);
    setGroup(match || '');
    setGroupOpen(value.trim().length > 0);
    if (!match) clearAssignee();
  }

  function selectGroup(key: string) {
    setGroup(key);
    setGroupQuery(groupLabel(key));
    setGroupOpen(false);
    clearAssignee();
  }

  function onMemberChange(user: {
    identity: string;
    displayName: string;
    avatarUrl: string | null;
    suggestedGroup?: string | null;
  }) {
    setAssignedUser(user.identity);
    setAssignedUserDisplayName(user.displayName);
    setAssignedUserAvatarUrl(user.avatarUrl);
    if (!group && user.suggestedGroup) {
      setGroup(user.suggestedGroup);
      setGroupQuery(groupLabel(user.suggestedGroup));
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
            <div ref={groupRef} className="relative">
              <label className="field-label">קבוצה יעד {capabilities?.isKeva && '(רק קבוצות שאתה חבר בהן)'}</label>
              <input
                className="input"
                value={groupQuery}
                onChange={(e) => onGroupInput(e.target.value)}
                onFocus={() => setGroupOpen(true)}
                placeholder="התחל להקליד קבוצה…"
                autoComplete="off"
              />
              {groupOpen && filteredGroups.length > 0 && (
                <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-subtle bg-surface shadow-elevated">
                  {filteredGroups.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectGroup(g.key)}
                      className={`w-full px-3 py-2 text-right text-sm transition first:rounded-t-xl last:rounded-b-xl hover:bg-neutral-50 dark:hover:bg-neutral-800/60 ${
                        group === g.key ? 'bg-indigo-50 font-medium dark:bg-indigo-950/30' : ''
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              )}
              {!allowedGroups.length && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  אין לך הרשאה לנתב לקבוצות. צור קשר עם המנהל.
                </p>
              )}
            </div>

            <UserSearchInput
              label="חבר צוות (אופציונלי)"
              value={assignedUser}
              displayName={assignedUserDisplayName}
              avatarUrl={assignedUserAvatarUrl}
              users={members}
              loading={membersLoading}
              placeholder={group ? 'חפש חבר צוות…' : 'חפש חבר צוות מכל הקבוצות…'}
              onChange={onMemberChange}
            />
            {membersWarning ? (
              <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {membersWarning}
              </p>
            ) : members.length === 0 && !membersLoading ? (
              <p className="muted text-xs">
                {group ? 'לא נמצאו חברי צוות בקבוצה זו ב-AD.' : 'לא נמצאו משתמשים זמינים לניתוב.'}
              </p>
            ) : (
              <p className="field-hint">
                {group
                  ? 'ללא שיוך — כל הצוות יראה את הפנייה. בחירת חבר ספציפי תשייך לטיפול אישי.'
                  : 'אפשר לבחור משתמש גם בלי לבחור קבוצה — הקבוצה תיבחר אוטומטית לפי המשתמש שנבחר.'}
              </p>
            )}
          </>
        )}

        {mode === 'manager' && (
          <>
            <UserSearchInput
              label="מנהל"
              value={assignedUser}
              displayName={assignedUserDisplayName}
              avatarUrl={assignedUserAvatarUrl}
              users={managers}
              loading={managersLoading}
              placeholder="חפש מנהל…"
              onChange={onMemberChange}
            />
            <p className="field-hint">
              הפנייה תועבר ישירות להחלטת המנהל ותדלג על שלב התייחסות הצוות.
            </p>
          </>
        )}

        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
