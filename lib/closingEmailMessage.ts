import { buildTemplateContext } from './emailTemplate.ts';
import type { InquiryRow } from './types.ts';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Short email body — the full letter is attached as PDF. */
export function buildClosingEmailCoverLetter(
  inquiry: InquiryRow,
  fromName: string,
): { text: string; html: string } {
  const ctx = buildTemplateContext(inquiry, fromName);
  const name = ctx.submitter_name || 'שלום';
  const subject = ctx.subject !== '—' ? ctx.subject : 'פנייתך';

  const text = `שלום ${name},

מצורף מכתב סיכום לפנייתך בנושא "${subject}".

בברכה,
${ctx.from_name}`;

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1e293b;">
  <p>שלום <strong>${escapeHtml(name)}</strong>,</p>
  <p>מצורף מכתב סיכום לפנייתך בנושא &quot;${escapeHtml(subject)}&quot;.</p>
  <p style="margin-top:1.25em;">בברכה,<br><strong>${escapeHtml(ctx.from_name)}</strong></p>
</body>
</html>`;

  return { text, html };
}

/** DD-MM-YYYY in Asia/Jerusalem (falls back to today when no date). */
function formatFileDate(value: string | Date | null | undefined): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('day')}-${get('month')}-${get('year')}`;
}

/** e.g. "מכתב סגירה - ישראל ישראלי - 16-06-2026.pdf" */
export function closingLetterPdfFilename(inquiry: InquiryRow): string {
  const name = (inquiry.submitter_name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '') // strip filesystem-illegal characters
    .replace(/\s+/g, ' ')
    .slice(0, 60)
    .trim();
  const date = formatFileDate(inquiry.closed_at);
  const parts = ['מכתב סגירה'];
  if (name) parts.push(name);
  if (date) parts.push(date);
  return `${parts.join(' - ')}.pdf`;
}
