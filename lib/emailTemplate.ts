import type { InquiryRow } from './types.ts';
import { CATEGORIES, JUSTIFICATION_LABEL_HE, type JustificationDecision } from './constants.ts';
import { DEFAULT_TARGET_GROUPS } from './constants.ts';
import { institutionalClosingLetterHtml } from './closingLetterHtml.ts';

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
  { key: 'closed_at', label: 'תאריך סגירה (ללא שעה)' },
  { key: 'form_timestamp', label: 'תאריך הגשה (ללא שעה)' },
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

const LETTER_DATE_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Jerusalem',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

/** Parse sheet-style (dd/mm/yyyy) or ISO timestamps; returns null if unparseable. */
function parseLetterDateInput(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || trimmed.includes('T')) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const sheet = trimmed.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (sheet) {
    const d = new Date(Number(sheet[3]), Number(sheet[2]) - 1, Number(sheet[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Formal letter date — Hebrew long form, no time (e.g. "9 ביוני 2026"). */
export function formatLetterDate(value: string | Date | null | undefined): string {
  if (!value) {
    return new Date().toLocaleDateString('he-IL', LETTER_DATE_OPTS);
  }
  const d = value instanceof Date ? value : parseLetterDateInput(String(value));
  if (!d || Number.isNaN(d.getTime())) {
    // Strip trailing time from strings like "01/06/2026 10:00:00"
    const stripped = String(value).replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, '').trim();
    return stripped || '—';
  }
  return d.toLocaleDateString('he-IL', LETTER_DATE_OPTS);
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
    closed_at: formatLetterDate(inquiry.closed_at),
    form_timestamp: formatLetterDate(inquiry.form_timestamp),
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
  return institutionalClosingLetterHtml(kind);
}

/** Long sample for preview — demonstrates multi-page PDF / letter flow. */
export const SAMPLE_MANAGER_RESPONSE_PREVIEW = `【 דוגמה: התייחסות ארוכה להמחשת מכתב רב-עמודי 】

לאחר שבחנו את פנייתך לעומק, להלן פירוט מלא של מהלך הטיפול, הממצאים וההחלטה:

1. קליטת הפנייה — הפנייה נקלטה במערכת, הועברה לגורם הרלוונטי בצוות ההוראה ונבדקה מול נתוני השיעורים והחומר שנמסר בכיתה.

2. בדיקה מול צוות ההוראה — נערכה שיחה עם מורה המקצוע, נבדקו דפי העבודה, ספרי הלימוד והנחיות שנמסרו לתלמידים במהלך השבועות האחרונים.

3. התאמות שנעשו — במקרים שזוהו פערים, המורה עדכנה את לוח המטלות, פרסמה בקבוצת הכיתה סיכום מסודר והעניקה שיעורי חיזוק לתלמידים שהתקשו.

4. מדיניות בית הספר — חלוקת שיעורי הבית נקבעת בהתאם לתכנית הלימודים המאושרת, תוך שמירה על איזון בין מקצועות ועומס סביר לשכבה.

5. תקשורת עם הורים — אנו ממליצים לפנות למחנכת או למורה המקצועי לעדכונים שוטפים. קיימות שעות קבלה שבועיות וערוץ דיגיטלי לעדכונים.

6. המשך מעקב — הצוות ימשיך לעקוב אחר התקדמות התלמידים ולוודא שהחומר מובן. במידת הצורך תוצע פגישה משותפת עם ההורים.

7. סיכום — אנו רואים חשיבות רבה בשיתוף ההורים ובשקיפות. הפנייה שלך תרמה לחידוד נקודות לשיפור ולעדכון נהלים מול הכיתה.

להלן הרחבה נוספת לצורך הדגמת עמוד שני במכתב:

במהלך השבועות הקרובים יתקיימו ישיבות צוות להערכת נהלי שיעורי הבית. נבחן האם יש צורך בעדכון לוחות, בהגדלת זמן הסבר בכיתה או בהקטנת היקף המטלות בתקופות עמוסות.

אנו מבקשים להגיב לפנייה זו בתוך חמישה ימי עסקים במקרה של שאלות המשך. ניתן לפנות למזכירות או למחנכת בטלפון או במייל.

תודה על שיתוף הפעולה ועל העניין בקידום הלמידה והחינוך בקרב בני הנוער במכללה.`;

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
    form_timestamp: '2026-06-01',
    created_at: new Date().toISOString(),
    routed_at: null,
    routed_by: null,
    assigned_group: 'tichnun',
    assigned_user: null,
    team_response: 'הצוות בדק את הנושא ולהלן הממצאים.',
    team_response_at: null,
    team_response_by: null,
    manager_response: SAMPLE_MANAGER_RESPONSE_PREVIEW,
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
