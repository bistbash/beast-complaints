/** Mirror of backend constants so the frontend can render the workflow without a round-trip. */

export const STATUS = {
  NEW: 'new',
  ROUTED: 'routed',
  AWAITING_MANAGER: 'awaiting_manager',
  CLOSED: 'closed',
} as const;

export type InquiryStatus = (typeof STATUS)[keyof typeof STATUS];

export const STATUS_META: Record<
  InquiryStatus,
  { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent' }
> = {
  new: { label: 'חדשה — ממתינה לניתוב', tone: 'warning' },
  routed: { label: 'מנותבת לצוות', tone: 'info' },
  awaiting_manager: { label: 'ממתינה להתייחסות מנהל', tone: 'accent' },
  closed: { label: 'סגורה', tone: 'success' },
};

export const OPEN_STATUSES: InquiryStatus[] = ['new', 'routed', 'awaiting_manager'];
export const CLOSED_STATUSES: InquiryStatus[] = ['closed'];

export const PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export type InquiryPriority = (typeof PRIORITY)[keyof typeof PRIORITY];

export const PRIORITY_META: Record<
  InquiryPriority,
  { label: string; tone: 'neutral' | 'info' | 'warning' | 'danger'; weight: number }
> = {
  low: { label: 'נמוכה', tone: 'neutral', weight: 4 },
  medium: { label: 'בינונית', tone: 'info', weight: 3 },
  high: { label: 'גבוהה', tone: 'warning', weight: 2 },
  urgent: { label: 'דחופה', tone: 'danger', weight: 1 },
};

export const CATEGORIES = [
  { value: 'technical', label: 'טכנית' },
  { value: 'pedagogical', label: 'פדגוגית' },
  { value: 'admin', label: 'מנהלה' },
  { value: 'discipline', label: 'משמעת' },
  { value: 'attendance', label: 'נוכחות' },
  { value: 'safety', label: 'בטיחות' },
  { value: 'other', label: 'אחר' },
] as const;

export const GROUP_LABELS: Record<string, string> = {
  tet: 'שכבה ט\'',
  yod: 'שכבה י\'',
  yod_a: 'שכבה י"א',
  yod_b: 'שכבה י"ב',
  handesaim: 'הנדסאים',
  tichnun: 'תפעול הדרכה',
  minhala: 'מנהלה',
  mechonot: 'מכונות',
  keva: 'קבע',
  morim: 'מורים',
  teachers: 'מורים',
};

export function groupLabel(key: string | null | undefined): string {
  if (!key) return '—';
  const normalized = key.toLowerCase() === 'teachers' ? 'morim' : key.toLowerCase();
  return GROUP_LABELS[normalized] || key;
}

export const MESSAGE_TYPE = {
  COMMENT: 'comment',
  SYSTEM: 'system',
  ROUTING: 'routing',
  STATUS_CHANGE: 'status_change',
  TEAM_RESPONSE: 'team_response',
  MANAGER_RESPONSE: 'manager_response',
} as const;

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

export const HISTORY_LABELS: Record<string, string> = {
  created: 'הפנייה נוצרה',
  routed: 'הפנייה נותבה',
  rerouted: 'הפנייה נותבה מחדש',
  assigned: 'הפנייה שויכה למטפל',
  status_changed: 'הסטטוס השתנה',
  priority_changed: 'הדחיפות עודכנה',
  team_response_submitted: 'נכתבה התייחסות צוות',
  manager_response_submitted: 'נכתבה התייחסות מנהל',
  justification_set: 'נקבעה הצדקת הפנייה',
  closed: 'הפנייה נסגרה',
  reopened: 'הפנייה נפתחה מחדש',
  comment_added: 'נוספה תגובה',
  closing_email_sent: 'נשלח מייל סיום',
  sla_breach: 'חריגה מיעד הטיפול (SLA)',
};

export const JUSTIFICATION = {
  JUSTIFIED: 'justified',
  UNJUSTIFIED: 'unjustified',
} as const;

export type JustificationDecision = (typeof JUSTIFICATION)[keyof typeof JUSTIFICATION];

export const JUSTIFICATION_META: Record<
  JustificationDecision,
  { label: string; tone: 'warning' | 'neutral'; description: string }
> = {
  justified: {
    label: 'מוצדקת',
    tone: 'warning',
    description: 'הפנייה נמצאה מוצדקת — יש לנקוט פעולה / לטפל בנושא.',
  },
  unjustified: {
    label: 'לא מוצדקת',
    tone: 'neutral',
    description: 'לאחר בחינה, לא נדרשת פעולה ביחס לפנייה זו.',
  },
};

export const RELATION_OPTIONS = [
  { value: 'parent', label: 'הורה' },
  { value: 'guardian', label: 'אפוטרופוס' },
  { value: 'student', label: 'תלמיד/ה' },
  { value: 'staff', label: 'איש צוות' },
  { value: 'other', label: 'אחר' },
] as const;
