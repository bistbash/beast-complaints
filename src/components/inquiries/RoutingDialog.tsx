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
  /** When opened from "שייך אליי" on an unrouted inquiry, pre-select the current user. */
  prefillSelf?: boolean;
  onRouted: () => void;
}

export default function RoutingDialog({
  open,
  onClose,
  inquiryId,
  currentGroup,
  capabilities,
  prefillSelf = false,
  onRouted,
}: RoutingDialogProps) {
  const [group, setGroup] = useState(currentGroup || '');
  const [members, setMembers] = useState<UserSearchOption[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersWarning, setMembersWarning] = useState<string | null>(null);
  const [assignedUser, setAssignedUser] = useState('');
  const [assignedUserDisplayName, setAssignedUserDisplayName] = useState('');
  const [assignedUserAvatarUrl, setAssignedUserAvatarUrl] = useState<string | null>(null);
  const [assigneeSkips, setAssigneeSkips] = useState(false);
  const [groupQuery, setGroupQuery] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const allowedGroups = capabilities?.manageableGroups || [];

  useEffect(() => {
    if (!open) return;
    const initialGroup = currentGroup || (allowedGroups.length === 1 ? allowedGroups[0] : '');
    setGroup(initialGroup);
    setGroupQuery(initialGroup ? groupLabel(initialGroup) : '');
    setError(null);
    if (prefillSelf && capabilities) {
      setAssignedUser(capabilities.email);
      setAssignedUserDisplayName(capabilities.displayName);
      setAssignedUserAvatarUrl(null);
      setAssigneeSkips(!!capabilities.skipsTeamResponse);
    } else {
      clearAssignee();
    }
  }, [open, currentGroup, allowedGroups, prefillSelf, capabilities]);

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
  }, [group]);

  function clearAssignee() {
    setAssignedUser('');
    setAssignedUserDisplayName('');
    setAssignedUserAvatarUrl(null);
    setAssigneeSkips(false);
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
    if (!user.identity) setAssigneeSkips(false);
    if (!group && user.suggestedGroup) {
      setGroup(user.suggestedGroup);
      setGroupQuery(groupLabel(user.suggestedGroup));
    }
  }

  useEffect(() => {
    if (!assignedUser) {
      setAssigneeSkips(false);
      return;
    }
    if (capabilities && assignedUser.toLowerCase() === capabilities.email.toLowerCase()) {
      setAssigneeSkips(!!capabilities.skipsTeamResponse);
      return;
    }
    let cancelled = false;
    api
      .get('/api/inquiries/lookup/assignee-role', { params: { user: assignedUser } })
      .then((res) => {
        if (!cancelled) setAssigneeSkips(!!res.data?.skipsTeamResponse);
      })
      .catch(() => {
        if (!cancelled) setAssigneeSkips(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignedUser, capabilities]);

  function assignToSelf() {
    if (!capabilities) return;
    if (!group && capabilities.manageableGroups.length === 1) {
      const key = capabilities.manageableGroups[0];
      setGroup(key);
      setGroupQuery(groupLabel(key));
    }
    setAssignedUser(capabilities.email);
    setAssignedUserDisplayName(capabilities.displayName);
    setAssignedUserAvatarUrl(null);
    setAssigneeSkips(!!capabilities.skipsTeamResponse);
    setError(null);
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      if (!group && !assignedUser) {
        setError('יש לבחור קבוצה או חבר צוות');
        return;
      }
      await api.post(`/api/inquiries/${inquiryId}/route`, {
        group: group || undefined,
        assignedUser: assignedUser || null,
      });
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
        <div className="flex items-center justify-between gap-3 rounded-xl border border-subtle bg-surface-elevated px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">שיוך לעצמי</p>
            <p className="muted text-xs">הפנייה תשויך אליך כגורם המטפל.</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={assignToSelf} disabled={!capabilities || submitting}>
            שייך אליי
          </Button>
        </div>

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

        {assigneeSkips && (
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            המטפל הוא מד״ר או מנהל בית הספר. הפנייה תדלג על תגובת הגורם המטפל ותעבור להתייחסות
            הסופית — התגובה תסגור את הפנייה ותישלח לפונה במייל.
          </p>
        )}

        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
