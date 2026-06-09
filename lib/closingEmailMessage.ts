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

export function closingLetterPdfFilename(inquiry: InquiryRow): string {
  const base = (inquiry.subject || 'פנייה')
    .trim()
    .slice(0, 60)
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base ? `מכתב-סגירה-${base}.pdf` : 'מכתב-סגירה.pdf';
}
