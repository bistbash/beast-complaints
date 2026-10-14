/**
 * Shared constants — kept in one place so frontend and backend stay in sync.
 *
 * Workflow:
 *
 *   [parent public form] → new
 *                            ↓ (navigator/keva routes to team member)
 *                          routed
 *                            ↓ (team member writes team_response)
 *                          awaiting_manager
 *                            ↓ (manager writes manager_response)
 *                          closed → [closing email sent to submitter]
 *
 *   Alternative path:
 *   Routing to a user whose Beast role is מד"ר (`madr`) or מנהל בית הספר
 *   (`school_manager`) skips the team response and lands on awaiting_manager.
 *   That person's manager response closes the inquiry and is emailed to the submitter.
 */

export const STATUS = {
  NEW: 'new',
  ROUTED: 'routed',
  AWAITING_MANAGER: 'awaiting_manager',
  CLOSED: 'closed',
} as const;

export type InquiryStatus = (typeof STATUS)[keyof typeof STATUS];

export const STATUS_LABEL_HE: Record<InquiryStatus, string> = {
  new: 'חדשה — ממתינה לניתוב',
  routed: 'מנותבת לצוות',
  awaiting_manager: 'ממתינה להתייחסות מנהל',
  closed: 'סגורה',
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

export const PRIORITY_LABEL_HE: Record<InquiryPriority, string> = {
  low: 'נמוכה',
  medium: 'בינונית',
  high: 'גבוהה',
  urgent: 'דחופה',
};

/**
 * Uniform 1-week SLA across all priorities. Kept as a per-priority map so the
 * shape stays open to reintroducing tighter deadlines for urgent/high later
 * without touching every call site.
 */
export const PRIORITY_SLA_HOURS: Record<InquiryPriority, number> = {
  low: 168,
  medium: 168,
  high: 168,
  urgent: 168,
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

export type InquiryCategory = (typeof CATEGORIES)[number]['value'];

/**
 * Default routable teams. Used as a fallback when TARGET_GROUPS env is empty.
 * `keva` is intentionally excluded — keva members can route across these
 * teams (provided they're members themselves) but `keva` itself is never a
 * routing target.
 */
export const DEFAULT_TARGET_GROUPS: { key: string; label: string }[] = [
  { key: 'tet', label: 'שכבה ט\'' },
  { key: 'yod', label: 'שכבה י\'' },
  { key: 'yod_a', label: 'שכבה י"א' },
  { key: 'yod_b', label: 'שכבה י"ב' },
  { key: 'handesaim', label: 'הנדסאים' },
  { key: 'tichnun', label: 'תפעול הדרכה' },
  { key: 'minhala', label: 'מנהלה' },
  { key: 'mechonot', label: 'מכונות' },
  { key: 'morim', label: 'מורים' },
];

export const MESSAGE_TYPE = {
  COMMENT: 'comment',
  SYSTEM: 'system',
  ROUTING: 'routing',
  STATUS_CHANGE: 'status_change',
  TEAM_RESPONSE: 'team_response',
  MANAGER_RESPONSE: 'manager_response',
} as const;

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

export const HISTORY_ACTION = {
  CREATED: 'created',
  ROUTED: 'routed',
  REROUTED: 'rerouted',
  ASSIGNED: 'assigned',
  STATUS_CHANGED: 'status_changed',
  PRIORITY_CHANGED: 'priority_changed',
  TEAM_RESPONSE_SUBMITTED: 'team_response_submitted',
  MANAGER_RESPONSE_SUBMITTED: 'manager_response_submitted',
  JUSTIFICATION_SET: 'justification_set',
  CLOSED: 'closed',
  REOPENED: 'reopened',
  COMMENT_ADDED: 'comment_added',
  CLOSING_EMAIL_SENT: 'closing_email_sent',
  SLA_BREACH: 'sla_breach',
  DELETED: 'deleted',
  DATES_EDITED: 'dates_edited',
} as const;

export type HistoryAction = (typeof HISTORY_ACTION)[keyof typeof HISTORY_ACTION];

/**
 * Beast role keys that both grant manager capability and, when an inquiry is
 * assigned to such a user, skip the handling-party response.
 * `madr` = מד"ר, `school_manager` = מנהל בית הספר.
 * MANAGER_ROLE_KEYS may add more keys; these two are always included.
 */
export const DEFAULT_MANAGER_ROLE_KEYS = ['madr', 'school_manager'];

export function managerRoleKeys(): string[] {
  const fromEnv = (process.env.MANAGER_ROLE_KEYS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_MANAGER_ROLE_KEYS, ...fromEnv]));
}

export function hasManagerRole(
  roles: Array<string | { key?: string | null } | null | undefined> | null | undefined,
): boolean {
  const wanted = new Set(managerRoleKeys());
  return (roles || []).some((role) => {
    if (!role) return false;
    const key = typeof role === 'string' ? role : role.key || '';
    return wanted.has(key.trim().toLowerCase());
  });
}

/** Group that grants "super team member" — sees all teams, but routes only within own teams. */
export const DEFAULT_KEVA_GROUP = 'keva';

/**
 * Manager's final judgment on the inquiry — required before closing.
 * `justified` means the complaint is valid (an issue exists / will be addressed).
 * `unjustified` means after review, no action is warranted.
 */
export const JUSTIFICATION = {
  JUSTIFIED: 'justified',
  UNJUSTIFIED: 'unjustified',
} as const;

export type JustificationDecision = (typeof JUSTIFICATION)[keyof typeof JUSTIFICATION];

export const JUSTIFICATION_LABEL_HE: Record<JustificationDecision, string> = {
  justified: 'מוצדקת',
  unjustified: 'לא מוצדקת',
};
