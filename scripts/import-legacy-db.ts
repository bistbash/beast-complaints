/**
 * One-shot migration: pull rich inquiry data from the previous complaints-manager
 * system (complaints-manager-roan.vercel.app export) into the current db-smart
 * dataset, preserving the workflow state (assignment, team response, manager
 * verdict, justification, message thread).
 *
 * Use this when the Google Sheets → db-smart sync has imported only the raw
 * form-submission columns and you need to backfill closed inquiries with the
 * actual workflow data from the legacy app.
 *
 * Matching strategy:
 *   - Legacy `createdAt` (ISO UTC) → format as Asia/Jerusalem "M/D/YYYY H:MM:SS"
 *     (matches the Google Form `timestamp` column exactly)
 *   - Match on (timestamp_string, lowercased email)
 *   - When a match is found, ONLY workflow columns are updated. Sheet columns
 *     stay untouched (db-smart still owns them).
 *
 * Idempotency:
 *   - Each imported row gets `legacy_id` set to the original `id` (e.g. `c_mi5ooshb`).
 *   - On re-runs, rows that already have a matching `legacy_id` get their messages
 *     re-synced only if missing — duplicate detection by author+created_at+content.
 *
 * Usage:
 *   npm run import-legacy-db -- data/legacy-export.tsv
 *   npm run import-legacy-db -- data/legacy-export.tsv --dry-run
 *
 * File format: TSV with the first line as the header. Required columns:
 *   id, createdAt, updatedAt, subject, title, body, status,
 *   departmentId, assigneeUserId, reporterType, reporterFullName,
 *   reporterEmail, reporterPhone, reporterDepartmentId, reporterGrade,
 *   reporterClassNumber, messagesJSON, assigneeLetterJSON, principalReviewJSON
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../config/db.ts';
import { loadDatasetMeta } from '../services/datasetMeta.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';
import { ensureInquiryWorkflowColumns } from '../lib/schema.ts';
import { HISTORY_ACTION, MESSAGE_TYPE } from '../lib/constants.ts';

const DATASET_ID = process.env.COMPLAINTS_DATASET_ID;

/** Map legacy statuses → current workflow statuses. */
const STATUS_MAP: Record<string, string> = {
  OPEN: 'new',
  ASSIGNED: 'routed',
  IN_PROGRESS: 'routed',
  AWAITING_PRINCIPAL: 'awaiting_manager',
  AWAITING_REVIEW: 'awaiting_manager',
  CLOSED: 'closed',
  ARCHIVED: 'closed',
};

/** Map legacy reporterType codes → display strings consistent with the Google Form. */
const REPORTER_TYPE_MAP: Record<string, string> = {
  PARENT_STUDENT: 'הורה\\שוחר',
  PARENT: 'הורה\\שוחר',
  STUDENT: 'הורה\\שוחר',
  STAFF: 'סגל',
  BISLAT: 'ביסל"ט',
  EMPLOYEE: 'סגל',
};

function parseArgs(): { file: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: tsx scripts/import-legacy-db.ts <file.tsv> [--dry-run]');
    process.exit(1);
  }
  return { file, dryRun: args.includes('--dry-run') };
}

function parseTsv(raw: string): string[][] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));
}

/**
 * Format a JS Date as the same "DD/MM/YYYY HH:MM:SS" string that Google Forms
 * stores in the new dataset's `timestamp` column (Asia/Jerusalem time, with
 * leading zeros — this is the Israeli locale format that db-smart syncs).
 */
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
  // Intl with hour12:false sometimes emits "24" for midnight; normalize to "00".
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('day')}/${get('month')}/${get('year')} ${hour}:${get('minute')}:${get('second')}`;
}

function safeJsonParse<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === '[]' || s === '{}') {
    // Distinguish "empty array" / "empty object" from "absent".
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

interface LegacyMessage {
  id?: string;
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
  reporterJobTitle: string;
  reporterDepartmentId: string;
  reporterGrade: string;
  reporterClassNumber: string;
  messagesJSON: string;
  assigneeLetterJSON: string;
  returnInfoJSON: string;
  reviewCyclesJSON: string;
  principalReviewJSON: string;
  notificationEmailJSON: string;
  reporterFlight: string;
}

function buildLegacyRow(headers: string[], values: string[]): LegacyRow {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = values[i] ?? '';
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

/** Returns null for closed-but-no-verdict (legacy rows where justified was simply absent). */
function pickJustification(review: LegacyPrincipalReview | null): 'justified' | 'unjustified' | null {
  if (!review) return null;
  if (typeof review.justified !== 'boolean') return null;
  return review.justified ? 'justified' : 'unjustified';
}

interface ImportStats {
  matched: number;
  inserted: number;
  workflowUpdated: number;
  messagesInserted: number;
  alreadyImported: number;
  unmatched: number;
}

async function main() {
  if (!DATASET_ID) {
    console.error('COMPLAINTS_DATASET_ID is not set in environment.');
    process.exit(1);
  }
  const { file, dryRun } = parseArgs();
  const abs = path.resolve(file);
  const raw = await fs.readFile(abs, 'utf8');
  const rows = parseTsv(raw);
  if (rows.length < 2) {
    console.error('File must have a header row and at least one data row.');
    process.exit(1);
  }
  const [headers, ...dataRows] = rows;

  const meta = await loadDatasetMeta(DATASET_ID);
  if (!meta) {
    console.error(`Dataset ${DATASET_ID} not found in db-smart.`);
    process.exit(1);
  }
  await ensureInquiryWorkflowColumns(pool, meta.tableName);

  const table = quoteIdent(meta.tableName);

  // Index existing rows by (timestamp_string, email).
  const existing = await pool.query<{
    inquiry_id: string;
    timestamp: string | null;
    email: string | null;
    legacy_id: string | null;
  }>(`SELECT inquiry_id, "timestamp", email, legacy_id FROM ${table}`);
  const byKey = new Map<string, { inquiry_id: string; legacy_id: string | null }>();
  const byEmailTitle = new Map<string, string>();
  const byLegacyId = new Map<string, string>();
  for (const r of existing.rows) {
    if (r.timestamp && r.email) {
      byKey.set(keyFor(r.timestamp, r.email), { inquiry_id: r.inquiry_id, legacy_id: r.legacy_id });
    }
    if (r.legacy_id) byLegacyId.set(r.legacy_id, r.inquiry_id);
  }

  const titleRows = await pool.query<{ inquiry_id: string; email: string | null; title: string | null }>(
    `SELECT inquiry_id, email, title FROM ${table}`,
  );
  for (const r of titleRows.rows) {
    if (r.email && r.title) byEmailTitle.set(emailTitleKey(r.email, r.title), r.inquiry_id);
  }

  console.log(`\nLoaded ${existing.rows.length} existing rows from "${meta.tableName}".`);
  console.log(`Processing ${dataRows.length} legacy rows from ${path.basename(abs)}...\n`);

  const stats: ImportStats = {
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
      console.warn(`  ⚠ skipping row id=${row.id}: missing createdAt or reporterEmail`);
      continue;
    }

    const createdDate = new Date(row.createdAt);
    if (isNaN(createdDate.getTime())) {
      stats.unmatched++;
      console.warn(`  ⚠ skipping row id=${row.id}: invalid createdAt "${row.createdAt}"`);
      continue;
    }
    const tsString = toGoogleSheetsFormat(createdDate);
    const key = keyFor(tsString, row.reporterEmail);

    const title = row.title || row.subject || '';
    let inquiryId =
      byLegacyId.get(row.id) ??
      byKey.get(key)?.inquiry_id ??
      (title ? byEmailTitle.get(emailTitleKey(row.reporterEmail, title)) : undefined) ??
      null;
    const alreadyImported = !!byLegacyId.get(row.id);

    if (!inquiryId) {
      // Insert a fresh row using sheet columns + workflow columns. This lets the
      // legacy data exist in the new system even if the Google Sheets sync hasn't
      // picked it up yet (e.g. very old form responses that were deleted from
      // the sheet).
      const insertCols: Record<string, unknown> = {
        timestamp: tsString,
        email: row.reporterEmail,
        full_name: row.reporterFullName,
        phone_number: row.reporterPhone || null,
        requester_type: normalizeReporterType(row.reporterType),
        department: row.reporterDepartmentId || null,
        grade_level: row.reporterGrade || null,
        class_name: row.reporterClassNumber || null,
        title: row.title || row.subject || '',
        description: row.body || '',
      };
      const cols = Object.keys(insertCols).filter((c) => insertCols[c] != null && insertCols[c] !== '');
      const vals = cols.map((c) => insertCols[c]);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      if (!dryRun) {
        const inserted = await pool.query<{ inquiry_id: string }>(
          `INSERT INTO ${table} (${cols.map((c) => quoteIdent(c)).join(', ')})
           VALUES (${placeholders.join(', ')})
           RETURNING inquiry_id`,
          vals,
        );
        inquiryId = inserted.rows[0]?.inquiry_id;
      }
      stats.inserted++;
      console.log(`  + inserted legacy row id=${row.id} (no Google Form match)`);
    } else {
      stats.matched++;
    }

    // In dry-run with no existing match we have no real UUID to attach
    // workflow updates / messages to. Skip the rest of the pipeline.
    if (!inquiryId) continue;

    // Build the workflow patch from legacy JSON columns.
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

    // Drop nulls so we don't overwrite present values with nothing
    // (e.g. team_response that's been set in the new UI shouldn't be wiped if the legacy row didn't have one).
    // Exception: status, last_activity_at, legacy_id — always set.
    const ALWAYS_SET = new Set(['status', 'last_activity_at', 'legacy_id']);
    for (const k of Object.keys(patch)) {
      if (patch[k] == null && !ALWAYS_SET.has(k)) delete patch[k];
    }

    const updateCols = Object.keys(patch);
    const updateVals = updateCols.map((c) => patch[c]);
    if (updateCols.length && !dryRun) {
      await pool.query(
        `UPDATE ${table}
            SET ${updateCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(', ')}
          WHERE inquiry_id = $${updateCols.length + 1}`,
        [...updateVals, inquiryId],
      );
    }
    stats.workflowUpdated++;

    // History log for the import action — also serves as idempotency marker.
    if (!alreadyImported && !dryRun) {
      await pool.query(
        `INSERT INTO complaints_history (inquiry_id, action, actor, details)
         VALUES ($1, $2, $3, $4)`,
        [inquiryId, HISTORY_ACTION.STATUS_CHANGED, 'system:legacy-import', { legacy_id: row.id, from: 'legacy_db' }],
      );
    }

    // Message thread — insert only if not already there.
    const messages = safeJsonParse<LegacyMessage[]>(row.messagesJSON) ?? [];
    if (messages.length > 0) {
      const existingMsgs = await pool.query<{ author: string; content: string; created_at: string }>(
        `SELECT author, content, created_at FROM complaints_messages WHERE inquiry_id = $1`,
        [inquiryId],
      );
      const seen = new Set(
        existingMsgs.rows.map((m) => `${m.author}|${m.content}`),
      );
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

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Done.`);
  console.log(`  matched existing rows:   ${stats.matched}`);
  console.log(`  inserted new rows:       ${stats.inserted}`);
  console.log(`  workflow updates:        ${stats.workflowUpdated}`);
  console.log(`  messages inserted:       ${stats.messagesInserted}`);
  console.log(`  rows already imported:   ${stats.alreadyImported}`);
  console.log(`  rows skipped/unmatched:  ${stats.unmatched}`);
  await pool.end();
}

function keyFor(timestamp: string, email: string): string {
  return `${(timestamp || '').trim()}||${(email || '').trim().toLowerCase()}`;
}

function emailTitleKey(email: string, title: string): string {
  return `${email.trim().toLowerCase()}||${title.trim()}`;
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
