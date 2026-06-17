import { useState } from 'react';
import api from '../../utils/api.ts';
import Button from '../ui/Button.tsx';
import Modal from '../ui/Modal.tsx';
import StatusPill from '../ui/StatusPill.tsx';
import Empty from '../ui/Empty.tsx';
import { formatDateTime } from '../../utils/format.ts';
import type { Notify } from '../../hooks/useToast.ts';

interface AdminInquiry {
  inquiry_id: string;
  subject: string;
  submitter_name: string;
  status: string;
  created_at: string;
}

interface Props {
  notify: Notify;
}

/**
 * Admin-only danger zone: search inquiries and permanently delete them.
 * A deletion requires typing the inquiry's exact subject as confirmation —
 * the same string is re-checked server-side. Built mainly to clean up the
 * test inquiries that pile up during development.
 */
export default function InquiryAdminPanel({ notify }: Props) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AdminInquiry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // The inquiry currently queued for deletion (drives the confirm modal).
  const [target, setTarget] = useState<AdminInquiry | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function search() {
    setLoading(true);
    setSearched(true);
    try {
      const res = await api.get('/api/inquiries', { params: { q: query.trim() || undefined, limit: 50 } });
      setItems(res.data?.inquiries || []);
    } catch {
      setItems([]);
      notify('err', 'חיפוש הפניות נכשל');
    } finally {
      setLoading(false);
    }
  }

  function openDelete(item: AdminInquiry) {
    setTarget(item);
    setConfirmText('');
  }

  function closeDelete() {
    if (deleting) return;
    setTarget(null);
    setConfirmText('');
  }

  async function confirmDelete() {
    if (!target) return;
    setDeleting(true);
    try {
      await api.delete(`/api/inquiries/${target.inquiry_id}`, {
        data: { confirmSubject: confirmText.trim() },
      });
      setItems((prev) => prev.filter((i) => i.inquiry_id !== target.inquiry_id));
      notify('ok', `הפנייה "${target.subject}" נמחקה לצמיתות`);
      setTarget(null);
      setConfirmText('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      notify('err', e.response?.data?.error || 'מחיקת הפנייה נכשלה');
    } finally {
      setDeleting(false);
    }
  }

  const confirmMatches = !!target && confirmText.trim() === (target.subject || '').trim();

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
        <strong className="font-semibold">אזור מסוכן.</strong> מחיקת פנייה היא לצמיתות ומוחקת גם את כל
        ההודעות וההיסטוריה שלה — אין שחזור. השתמשו בכך בעיקר לניקוי פניות בדיקה.
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          className="input flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש פנייה לפי נושא, תיאור או שם פונה…"
        />
        <Button type="submit" variant="ghost" loading={loading}>
          חפש
        </Button>
      </form>

      {searched && !loading && items.length === 0 && (
        <Empty title="לא נמצאו פניות" description="נסו מונח חיפוש אחר." />
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-subtle overflow-hidden rounded-xl border border-subtle">
          {items.map((item) => (
            <li key={item.inquiry_id} className="flex items-center justify-between gap-3 bg-surface p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{item.subject || '(ללא נושא)'}</span>
                  <StatusPill status={item.status} size="sm" />
                </div>
                <div className="muted mt-0.5 truncate text-xs">
                  {item.submitter_name} · {formatDateTime(item.created_at)}
                </div>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => openDelete(item)}
                className="shrink-0"
              >
                מחק
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!target}
        onClose={closeDelete}
        title="מחיקת פנייה לצמיתות"
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closeDelete} disabled={deleting}>
              ביטול
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void confirmDelete()}
              loading={deleting}
              disabled={!confirmMatches}
            >
              מחק לצמיתות
            </Button>
          </>
        }
      >
        {target && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed">
              פעולה זו תמחק את הפנייה <strong>"{target.subject}"</strong> ואת כל ההודעות וההיסטוריה
              שלה — לצמיתות וללא אפשרות שחזור.
            </p>
            <div>
              <label className="field-label">
                להמשך, הקלידו את שם הפנייה במדויק:
              </label>
              <div className="muted mb-1 select-all rounded-md bg-surface-sunken px-2 py-1 text-xs">
                {target.subject}
              </div>
              <input
                className="input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="הקלידו כאן את שם הפנייה"
                autoFocus
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
