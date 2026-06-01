import type { InquiryRow } from './types.ts';
import { CATEGORIES, JUSTIFICATION_LABEL_HE, type JustificationDecision } from './constants.ts';
import { DEFAULT_TARGET_GROUPS } from './constants.ts';

export type EmailTemplateKind = JustificationDecision;

export interface EmailTemplateVariable {
  key: string;
  label: string;
}

export const EMAIL_TEMPLATE_VARIABLES: EmailTemplateVariable[] = [
  { key: 'submitter_name', label: 'שם הפונה' },
  { key: 'submitter_email', label: 'אימייל הפונה' },
  { key: 'submitter_phone', label: 'טלפון הפונה' },
  { key: 'submitter_relation', label: 'קשר הפונה' },
  { key: 'subject', label: 'נושא הפנייה' },
  { key: 'description', label: 'תיאור הפנייה' },
  { key: 'category', label: 'קטגוריה' },
  { key: 'justification_label', label: 'החלטה (מוצדקת/לא)' },
  { key: 'manager_response', label: 'התייחסות מנהל' },
  { key: 'team_response', label: 'התייחסות צוות' },
  { key: 'closed_at', label: 'תאריך סגירה' },
  { key: 'form_timestamp', label: 'תאריך הגשה בטופס' },
  { key: 'grade_level', label: 'שכבה' },
  { key: 'class_name', label: 'כיתה' },
  { key: 'department', label: 'מחלקה' },
  { key: 'assigned_group', label: 'קבוצה משויכת' },
  { key: 'from_name', label: 'שם השולח' },
];

const GROUP_LABELS: Record<string, string> = Object.fromEntries(
  DEFAULT_TARGET_GROUPS.map((g) => [g.key, g.label]),
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatClosedDate(closedAt: string | null): string {
  if (!closedAt) return new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  try {
    return new Date(closedAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  } catch {
    return closedAt;
  }
}

function categoryLabel(value: string | null): string {
  if (!value) return '—';
  const hit = CATEGORIES.find((c) => c.value === value);
  return hit?.label ?? value;
}

function groupLabel(key: string | null): string {
  if (!key) return '—';
  const k = key.toLowerCase() === 'teachers' ? 'morim' : key.toLowerCase();
  return GROUP_LABELS[k] ?? key;
}

function str(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export function buildTemplateContext(inquiry: InquiryRow, fromName: string): Record<string, string> {
  const justification = inquiry.justification;
  const justificationLabel =
    justification && justification in JUSTIFICATION_LABEL_HE
      ? JUSTIFICATION_LABEL_HE[justification as keyof typeof JUSTIFICATION_LABEL_HE]
      : '—';

  return {
    submitter_name: inquiry.submitter_name?.trim() || 'שלום',
    submitter_email: str(inquiry.submitter_email),
    submitter_phone: str(inquiry.submitter_phone),
    submitter_relation: str(inquiry.submitter_relation),
    subject: str(inquiry.subject),
    description: str(inquiry.description),
    category: categoryLabel(inquiry.category as string | null),
    justification_label: justificationLabel,
    manager_response: str(inquiry.manager_response),
    team_response: str(inquiry.team_response),
    closed_at: formatClosedDate(inquiry.closed_at),
    form_timestamp: str(inquiry.form_timestamp),
    grade_level: str(inquiry.grade_level),
    class_name: inquiry.class_name != null ? String(inquiry.class_name) : '—',
    department: str(inquiry.department),
    assigned_group: groupLabel(inquiry.assigned_group),
    from_name: fromName,
  };
}

/** Replace `{{key}}` — text fields escaped; `asset_*` values inserted raw (cid/data URLs). */
export function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, key: string) => {
    const k = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(context, k)) {
      if (k.startsWith('asset_')) return '';
      return _match;
    }
    const value = context[k] ?? '';
    if (k.startsWith('asset_')) return value;
    return escapeHtml(value);
  });
}

export function defaultSubjectTemplate(_kind: EmailTemplateKind): string {
  return 'סגירת פנייה: {{subject}}';
}

export function defaultHtmlTemplate(kind: EmailTemplateKind): string {
  const intro =
    kind === 'justified'
      ? 'לאחר בדיקה, הפנייה שלך נמצאה <strong>מוצדקת</strong>. להלן סיכום הטיפול וההחלטה:'
      : 'לאחר בדיקה מעמיקה, <strong>לא נמצא בסיס</strong> להמשך טיפול בפנייה זו. להלן הסבר המנהל:';

  const accent = kind === 'justified' ? '#059669' : '#64748b';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Assistant',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px 36px;">
              <img src="{{asset_logo}}" alt="" style="max-width:140px;height:auto;display:block;margin-bottom:14px;" />
              <p style="margin:0 0 6px;font-size:13px;font-weight:500;color:rgba(255,255,255,0.88);letter-spacing:0.02em;">פניות לקוח</p>
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">עדכון על פנייתך</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 36px 28px;color:#1e293b;font-size:15px;line-height:1.75;">
              <p style="margin:0 0 20px;font-size:16px;">שלום <strong>{{submitter_name}}</strong>,</p>
              <p style="margin:0 0 24px;color:#475569;">${intro}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;">פרטי הפנייה</p>
                    <p style="margin:0 0 8px;font-size:14px;"><span style="color:#64748b;">נושא:</span> {{subject}}</p>
                    <p style="margin:0 0 8px;font-size:14px;"><span style="color:#64748b;">החלטה:</span> <span style="color:${accent};font-weight:600;">{{justification_label}}</span></p>
                    <p style="margin:0;font-size:14px;"><span style="color:#64748b;">תאריך סגירה:</span> {{closed_at}}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#64748b;">התייחסות המנהל</p>
              <div style="white-space:pre-wrap;background:#f1f5f9;border-right:4px solid #6366f1;padding:16px 18px;border-radius:0 10px 10px 0;font-size:14px;line-height:1.65;color:#334155;">{{manager_response}}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 36px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
              <img src="{{asset_signature}}" alt="" style="max-width:180px;height:auto;display:block;margin-bottom:12px;" />
              <p style="margin:0;font-size:14px;color:#64748b;">בברכה,</p>
              <p style="margin:6px 0 0;font-size:15px;font-weight:600;color:#1e293b;">{{from_name}}</p>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0;font-size:11px;color:#94a3b8;text-align:center;">הודעה זו נשלחה אוטומטית ממערכת פניות הלקוח</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function sampleInquiryForPreview(kind: EmailTemplateKind): InquiryRow {
  return {
    inquiry_id: '00000000-0000-0000-0000-000000000000',
    subject: 'דוגמה: פנייה לגבי שיעורי בית',
    description: 'תיאור לדוגמה של הפנייה כפי שהוזן בטופס.',
    status: 'closed',
    priority: 'medium',
    category: 'pedagogical',
    submitter_name: 'ישראל ישראלי',
    submitter_email: 'parent@example.com',
    submitter_phone: '050-0000000',
    submitter_relation: 'הורה',
    grade_level: 'י\'',
    class_name: 3,
    department: null,
    entity: null,
    role: null,
    role_bislat: null,
    form_timestamp: '01/06/2026 10:00:00',
    created_at: new Date().toISOString(),
    routed_at: null,
    routed_by: null,
    assigned_group: 'tichnun',
    assigned_user: null,
    team_response: 'הצוות בדק את הנושא ולהלן הממצאים.',
    team_response_at: null,
    team_response_by: null,
    manager_response: 'תודה על פנייתך. לאחר בדיקה, זהו ניסוח לדוגמה של התייחסות המנהל.',
    manager_response_at: new Date().toISOString(),
    manager_response_by: 'manager@school.local',
    justification: kind,
    justification_at: new Date().toISOString(),
    justification_by: 'manager@school.local',
    closed_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    due_at: null,
    closing_email_sent_at: null,
  };
}
