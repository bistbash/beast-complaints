import { useEffect, useState } from 'react';
import Modal from '../ui/Modal.tsx';
import Button from '../ui/Button.tsx';
import api from '../../utils/api.ts';

/** Workflow date columns editable through the hidden shortcut — must mirror the
 * server's EDITABLE_DATE_COLUMNS whitelist. */
const DATE_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'created_at', label: 'תאריך הגשה' },
  { key: 'due_at', label: 'יעד טיפול (SLA)' },
  { key: 'routed_at', label: 'תאריך ניתוב' },
  { key: 'team_response_at', label: 'תאריך התייחסות צוות' },
  { key: 'manager_response_at', label: 'תאריך התייחסות מנהל' },
  { key: 'justification_at', label: 'תאריך קביעת הצדקה' },
  { key: 'closed_at', label: 'תאריך סגירה' },
  { key: 'closing_email_sent_at', label: 'תאריך שליחת מייל סגירה' },
];

/** ISO/UTC → value for a <input type="datetime-local"> in the browser's local TZ. */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface DateEditorDialogProps {
  open: boolean;
  onClose: () => void;
  inquiryId: string;
  /** Current date values, keyed by column name (raw ISO strings from the API). */
  values: Record<string, string | null | undefined>;
  onSaved: () => void;
}

export default function DateEditorDialog({
  open,
  onClose,
  inquiryId,
  values,
  onSaved,
}: DateEditorDialogProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const f of DATE_FIELDS) next[f.key] = toDatetimeLocal(values[f.key]);
    setDraft(next);
    setError(null);
  }, [open, values]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      // Send every field: empty inputs become null so a date can also be cleared.
      const dates: Record<string, string | null> = {};
      for (const f of DATE_FIELDS) {
        const v = draft[f.key];
        dates[f.key] = v ? new Date(v).toISOString() : null;
      }
      await api.post(`/api/inquiries/${inquiryId}/dates`, { dates });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'עדכון התאריכים נכשל');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="עריכת תאריכי הפנייה"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            ביטול
          </Button>
          <Button variant="primary" size="sm" onClick={submit} loading={submitting}>
            שמור תאריכים
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="muted text-xs">
          כלי ניהולי מוסתר לתיקון תאריכי מהלך הטיפול (למשל פניות שיובאו/סונכרנו עם תאריך שגוי).
          השארת שדה ריק תמחק את הערך.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {DATE_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="field-label" htmlFor={`date-${f.key}`}>
                {f.label}
              </label>
              <input
                id={`date-${f.key}`}
                type="datetime-local"
                className="input"
                dir="ltr"
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
