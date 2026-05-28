import { pool } from '../config/db.ts';
import { loadDatasetMeta } from './datasetMeta.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';
import { ensureInquiryWorkflowColumns } from '../lib/schema.ts';
import { HISTORY_ACTION, MESSAGE_TYPE } from '../lib/constants.ts';

const STATUS_MAP: Record<string, string> = {
  OPEN: 'new',
  ASSIGNED: 'routed',
  IN_PROGRESS: 'routed',
  AWAITING_PRINCIPAL: 'awaiting_manager',
  AWAITING_REVIEW: 'awaiting_manager',
  CLOSED: 'closed',
  ARCHIVED: 'closed',
};

const REPORTER_TYPE_MAP: Record<string, string> = {
  PARENT_STUDENT: 'הורה\\שוחר',
  PARENT: 'הורה\\שוחר',
  STUDENT: 'הורה\\שוחר',
  STAFF: 'סגל',
  BISLAT: 'ביסל"ט',
  EMPLOYEE: 'סגל',
};

export interface LegacyImportStats {
  matched: number;
  inserted: number;
  workflowUpdated: number;
  messagesInserted: number;
  alreadyImported: number;
  unmatched: number;
}

export interface LegacyImportResult {
  dryRun: boolean;
  rowCount: number;
  stats: LegacyImportStats;
  warnings: string[];
}

interface LegacyMessage {
  authorId?: string;
  body?: string;
  createdAt?: string;
}

interface LegacyAssigneeLetter {
  body?: string;
  authorUserId?: string;
  submittedAt?: string;
  updatedAt?: string;
}

interface LegacyPrincipalReview {
  justified?: boolean;
  summary?: string;
  signedByUserId?: string;
  signedAt?: string;
}

interface LegacyNotification {
  sentAt?: string;
  status?: string;
}

interface LegacyRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  subject: string;
  title: string;
  body: string;
  status: string;
  departmentId: string;
  assigneeUserId: string;
  createdById: string;
  reporterType: string;
  reporterFullName: string;
  reporterEmail: string;
  reporterPhone: string;
  reporterDepartmentId: string;
  reporterGrade: string;
  reporterClassNumber: string;
  messagesJSON: string;
  assigneeLetterJSON: string;
  principalReviewJSON: string;
  notificationEmailJSON: string;
}

/** Legacy `subject` = Google Form `request_category` (e.g. "דרכי הגעה לבית הספר"). */
const REQUIRED_INSERT_COLUMNS = new Set([
  'timestamp',
  'email',
  'full_name',
  'phone_number',
  'request_category',
  'title',
  'description',
]);

function parseLegacyPhone(raw: string | undefined | null): number {
  if (!raw) return 0;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

function buildLegacyInsertCols(row: LegacyRow, tsString: string): Record<string, unknown> {
  const category = (row.subject || row.title || 'אחר').trim();
  const title = (row.title || row.subject || 'ללא נושא').trim();
  const description = (row.body || '').trim() || '—';

  return {
    timestamp: tsString,
    email: row.reporterEmail.trim(),
    full_name: (row.reporterFullName || 'לא ידוע').trim(),
    phone_number: parseLegacyPhone(row.reporterPhone),
    request_category: category,
    title,
    description,
    requester_type: normalizeReporterType(row.reporterType),
    department: row.reporterDepartmentId || null,
    grade_level: row.reporterGrade || null,
    class_name: row.reporterClassNumber || null,
  };
}

function insertColumnNames(cols: Record<string, unknown>): string[] {
  return Object.keys(cols).filter((c) => {
    if (REQUIRED_INSERT_COLUMNS.has(c)) return true;
    const v = cols[c];
    return v != null && v !== '';
  });
}

export function parseLegacyTsv(raw: string): string[][] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split('\t'));
}

function toGoogleSheetsFormat(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('day')}/${get('month')}/${get('year')} ${hour}:${get('minute')}:${get('second')}`;
}

function safeJsonParse<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === '[]' || s === '{}') {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function buildLegacyRow(headers: string[], values: string[]): LegacyRow {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i].trim()] = values[i] ?? '';
  }
  return obj as unknown as LegacyRow;
}

function normalizeStatus(s: string): string {
  return STATUS_MAP[(s || '').toUpperCase()] || 'new';
}

function normalizeReporterType(s: string): string | null {
  if (!s) return null;
  const key = s.trim().toUpperCase();
  return REPORTER_TYPE_MAP[key] || s.trim();
}

function pickJustification(review: LegacyPrincipalReview | null): 'justified' | 'unjustified' | null {
  if (!review) return null;
  if (typeof review.justified !== 'boolean') return null;
  return review.justified ? 'justified' : 'unjustified';
}

function keyFor(timestamp: string, email: string): string {
  return `${(timestamp || '').trim()}||${(email || '').trim().toLowerCase()}`;
}

function emailTitleKey(email: string, title: string): string {
  return `${(email || '').trim().toLowerCase()}||${(title || '').trim()}`;
}

function parseSheetTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.000+02:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function findFuzzyMatch(
  row: LegacyRow,
  tsString: string,
  byEmailTitle: Map<string, Array<{ inquiry_id: string; timestamp: string; legacy_id: string | null }>>,
): string | null {
  const title = (row.title || row.subject || '').trim();
  if (!title) return null;
  const candidates = byEmailTitle.get(emailTitleKey(row.reporterEmail, title)) || [];
  if (!candidates.length) return null;

  const target = parseSheetTimestamp(tsString);
  if (!target) return null;

  let best: { inquiry_id: string; delta: number; legacy_id: string | null } | null = null;
  for (const c of candidates) {
    const t = parseSheetTimestamp(c.timestamp);
    if (!t) continue;
    const delta = Math.abs(t.getTime() - target.getTime());
    if (!best || delta < best.delta) {
      best = { inquiry_id: c.inquiry_id, delta, legacy_id: c.legacy_id };
    }
  }

  // Allow small clock drifts from sheet sync (1-2 sec).
  if (!best || best.delta > 5000) return null;
  return best.inquiry_id;
}

/**
 * Import legacy complaints-manager export (TSV) into the db-smart dataset.
 * Matches rows by (timestamp in Asia/Jerusalem format, reporter email).
 */
export async function importLegacyTsv(
  raw: string,
  options: { dryRun?: boolean; datasetId?: string } = {},
): Promise<LegacyImportResult> {
  const dryRun = !!options.dryRun;
  const datasetId = options.datasetId || process.env.COMPLAINTS_DATASET_ID || '';
  const warnings: string[] = [];

  if (!datasetId) {
    throw new Error('COMPLAINTS_DATASET_ID is not configured');
  }

  const rows = parseLegacyTsv(raw);
  if (rows.length < 2) {
    throw new Error('הקובץ חייב לכלול שורת כותרות ולפחות שורת נתונים אחת');
  }

  const [headers, ...dataRows] = rows;
  if (!headers.includes('createdAt') || !headers.includes('reporterEmail')) {
    throw new Error('חסרות עמודות חובה: createdAt, reporterEmail');
  }

  const meta = await loadDatasetMeta(datasetId);
  if (!meta) {
    throw new Error(`Dataset ${datasetId} not found`);
  }
  await ensureInquiryWorkflowColumns(pool, meta.tableName);

  const table = quoteIdent(meta.tableName);
  const existing = await pool.query<{
    inquiry_id: string;
    timestamp: string | null;
    email: string | null;
    legacy_id: string | null;
    title: string | null;
  }>(`SELECT inquiry_id, "timestamp", email, legacy_id, title FROM ${table}`);

  const byKey = new Map<string, { inquiry_id: string; legacy_id: string | null }>();
  const byEmailTitle = new Map<
    string,
    Array<{ inquiry_id: string; timestamp: string; legacy_id: string | null }>
  >();
  const byLegacyId = new Map<string, string>();
  for (const r of existing.rows) {
    if (r.timestamp && r.email) {
      byKey.set(keyFor(r.timestamp, r.email), { inquiry_id: r.inquiry_id, legacy_id: r.legacy_id });
    }
    if (r.timestamp && r.email && r.title) {
      const k = emailTitleKey(r.email, r.title);
      const arr = byEmailTitle.get(k) || [];
      arr.push({ inquiry_id: r.inquiry_id, timestamp: r.timestamp, legacy_id: r.legacy_id });
      byEmailTitle.set(k, arr);
    }
    if (r.legacy_id) byLegacyId.set(r.legacy_id, r.inquiry_id);
  }

  const stats: LegacyImportStats = {
    matched: 0,
    inserted: 0,
    workflowUpdated: 0,
    messagesInserted: 0,
    alreadyImported: 0,
    unmatched: 0,
  };

  for (const data of dataRows) {
    const row = buildLegacyRow(headers, data);
    if (!row.createdAt || !row.reporterEmail) {
      stats.unmatched++;
      warnings.push(`דילוג על שורה id=${row.id || '?'}: חסר createdAt או reporterEmail`);
      continue;
    }

    const createdDate = new Date(row.createdAt);
    if (isNaN(createdDate.getTime())) {
      stats.unmatched++;
      warnings.push(`דילוג על שורה id=${row.id}: תאריך לא תקין "${row.createdAt}"`);
      continue;
    }

    const tsString = toGoogleSheetsFormat(createdDate);
    let inquiryId = byLegacyId.get(row.id) ?? byKey.get(keyFor(tsString, row.reporterEmail))?.inquiry_id ?? null;
    const alreadyImported = !!byLegacyId.get(row.id);
    if (!inquiryId) {
      inquiryId = findFuzzyMatch(row, tsString, byEmailTitle);
      if (inquiryId) {
        warnings.push(`שורה id=${row.id}: בוצעה התאמה חכמה לפי אימייל+נושא (timestamp קרוב).`);
      }
    }

    if (!inquiryId) {
      const insertCols = buildLegacyInsertCols(row, tsString);
      const cols = insertColumnNames(insertCols);
      if (!dryRun) {
        const inserted = await pool.query<{ inquiry_id: string }>(
          `INSERT INTO ${table} (${cols.map((c) => quoteIdent(c)).join(', ')})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
           RETURNING inquiry_id`,
          cols.map((c) => insertCols[c]),
        );
        inquiryId = inserted.rows[0]?.inquiry_id;
        if (inquiryId && row.id) byLegacyId.set(row.id, inquiryId);
      } else {
        warnings.push(
          `שורה id=${row.id}: לא נמצאה התאמה — בייבוא אמיתי תיווצר רשומה חדשה (קטגוריה: ${insertCols.request_category})`,
        );
      }
      stats.inserted++;
    } else {
      stats.matched++;
    }

    if (!inquiryId) continue;

    const assigneeLetter = safeJsonParse<LegacyAssigneeLetter>(row.assigneeLetterJSON);
    const principalReview = safeJsonParse<LegacyPrincipalReview>(row.principalReviewJSON);
    const notification = safeJsonParse<LegacyNotification>(row.notificationEmailJSON);
    const justification = pickJustification(principalReview);
    const targetStatus = normalizeStatus(row.status);
    const closedAt =
      targetStatus === 'closed'
        ? principalReview?.signedAt || row.updatedAt || row.createdAt
        : null;

    const patch: Record<string, unknown> = {
      status: targetStatus,
      assigned_group: row.departmentId || null,
      assigned_user: row.assigneeUserId || null,
      routed_by: row.createdById || null,
      routed_at: row.assigneeUserId ? row.createdAt : null,
      team_response: assigneeLetter?.body || null,
      team_response_at: assigneeLetter?.submittedAt || assigneeLetter?.updatedAt || null,
      team_response_by: assigneeLetter?.authorUserId || null,
      manager_response: principalReview?.summary || null,
      manager_response_at: principalReview?.signedAt || null,
      manager_response_by: principalReview?.signedByUserId || null,
      justification,
      justification_at: justification ? principalReview?.signedAt || null : null,
      justification_by: justification ? principalReview?.signedByUserId || null : null,
      closed_at: closedAt,
      closing_email_sent_at:
        targetStatus === 'closed' && notification?.status === 'SUCCESS' ? notification.sentAt : null,
      last_activity_at: row.updatedAt || row.createdAt,
      legacy_id: row.id,
    };

    const ALWAYS_SET = new Set(['status', 'last_activity_at', 'legacy_id']);
    for (const k of Object.keys(patch)) {
      if (patch[k] == null && !ALWAYS_SET.has(k)) delete patch[k];
    }

    const updateCols = Object.keys(patch);
    if (updateCols.length && !dryRun) {
      await pool.query(
        `UPDATE ${table}
            SET ${updateCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(', ')}
          WHERE inquiry_id = $${updateCols.length + 1}`,
        [...updateCols.map((c) => patch[c]), inquiryId],
      );
    }
    stats.workflowUpdated++;

    if (!alreadyImported && !dryRun) {
      await pool.query(
        `INSERT INTO complaints_history (inquiry_id, action, actor, details)
         VALUES ($1, $2, $3, $4)`,
        [inquiryId, HISTORY_ACTION.STATUS_CHANGED, 'system:legacy-import', { legacy_id: row.id, from: 'legacy_db' }],
      );
    }

    const messages = safeJsonParse<LegacyMessage[]>(row.messagesJSON) ?? [];
    if (messages.length > 0) {
      const existingMsgs = await pool.query<{ author: string; content: string }>(
        `SELECT author, content FROM complaints_messages WHERE inquiry_id = $1`,
        [inquiryId],
      );
      const seen = new Set(existingMsgs.rows.map((m) => `${m.author}|${m.content}`));
      for (const msg of messages) {
        if (!msg.body) continue;
        const author = msg.authorId || 'system:legacy';
        const sig = `${author}|${msg.body}`;
        if (seen.has(sig)) continue;
        if (!dryRun) {
          await pool.query(
            `INSERT INTO complaints_messages (inquiry_id, author, author_name, content, message_type, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              inquiryId,
              author,
              null,
              msg.body,
              MESSAGE_TYPE.COMMENT,
              msg.createdAt || row.updatedAt || new Date().toISOString(),
            ],
          );
        }
        seen.add(sig);
        stats.messagesInserted++;
      }
    }

    if (alreadyImported) stats.alreadyImported++;
  }

  return { dryRun, rowCount: dataRows.length, stats, warnings };
}

export function isLegacyImportEnabled(): boolean {
  const v = (process.env.LEGACY_IMPORT_ENABLED ?? 'true').trim().toLowerCase();
  return v !== 'false' && v !== '0';
}
