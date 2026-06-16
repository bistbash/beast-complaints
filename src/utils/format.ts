const HE_LOCALE = 'he-IL';
const TZ = 'Asia/Jerusalem';

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(HE_LOCALE, { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(HE_LOCALE, {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = d.getTime() - Date.now();
  const absMin = Math.abs(diff) / 60000;
  if (absMin < 1) return 'הרגע';
  if (absMin < 60) return `${Math.round(absMin)} דק'`;
  const absHour = absMin / 60;
  if (absHour < 24) {
    const h = Math.round(absHour);
    return diff < 0 ? `לפני ${h} שעות` : `בעוד ${h} שעות`;
  }
  const absDay = absHour / 24;
  if (absDay < 30) {
    const dd = Math.round(absDay);
    return diff < 0 ? `לפני ${dd} ימים` : `בעוד ${dd} ימים`;
  }
  return formatDate(d);
}

/** Returns urgency level based on due_at: 'critical' (overdue), 'warning' (<25%), 'normal'. */
export function computeUrgency(
  createdAt: string | null | undefined,
  dueAt: string | null | undefined,
  status: string,
): 'critical' | 'warning' | 'normal' {
  if (!dueAt || ['resolved', 'closed'].includes(status)) return 'normal';
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return 'normal';
  const now = Date.now();
  if (due <= now) return 'critical';
  const created = createdAt ? new Date(createdAt).getTime() : now;
  const total = due - created;
  const remaining = due - now;
  if (total > 0 && remaining / total < 0.25) return 'warning';
  return 'normal';
}

export function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join('') || '?';
}

/**
 * Turn an email / username into a readable fallback name, used when the Beast
 * directory can't resolve a real display name. Never shows an English placeholder.
 *   "ilan.brand@beast.org" → "Ilan Brand"
 */
export function humanizeIdentifier(identifier?: string | null): string {
  const raw = String(identifier ?? '').trim();
  if (!raw) return 'משתמש';
  const local = raw.split('@')[0];
  const words = local.split(/[._+\-]+/).filter(Boolean);
  if (!words.length) return raw;
  return words
    .map((w) => (/^[a-z]/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
