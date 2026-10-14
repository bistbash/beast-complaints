import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';
import {
  STATUS,
  PRIORITY_SLA_HOURS,
  HISTORY_ACTION,
  MESSAGE_TYPE,
  JUSTIFICATION,
  DEFAULT_TARGET_GROUPS,
  type InquiryStatus,
  type InquiryPriority,
  type HistoryAction,
  type JustificationDecision,
} from '../lib/constants.ts';
import type { DatasetMeta, InquiryRow, MessageRow, HistoryRow } from '../lib/types.ts';
import {
  INQUIRY_DEDUPE_DESCRIPTION_KEY,
  INQUIRY_DEDUPE_ORDER,
  INQUIRY_DEDUPE_PARTITION,
  inquiryListOrderSql,
} from '../lib/inquiryDedupe.ts';
import { humanizeIdentifier } from '../lib/humanize.ts';

/**
 * Columns the db-smart sync populates from the Google Form (do not touch via INSERT/UPDATE).
 * These are the actual column names in the existing dataset table.
 */
const SHEET_COLUMNS = [
  'timestamp',
  'email',
  'full_name',
  'phone_number',
  'requester_type',
  'role_bislat',
  'department',
  'entity',
  'role',
  'grade_level',
  'class_name',
  'request_category',
  'title',
  'description',
];

export const REQUIRED_INQUIRY_COLUMNS = SHEET_COLUMNS;

/**
 * SELECT clause that exposes the dataset row as our InquiryRow shape.
 * Aliases the Google-Form columns to friendlier names so the rest of the codebase
 * doesn't need to know about the underlying naming convention.
 */
const INQUIRY_SELECT = `
  inquiry_id,
  status,
  priority,
  title                 AS subject,
  description,
  request_category      AS category,
  full_name             AS submitter_name,
  email                 AS submitter_email,
  COALESCE(phone_number::text, '') AS submitter_phone,
  requester_type        AS submitter_relation,
  grade_level,
  class_name,
  department,
  entity,
  role,
  role_bislat,
  "timestamp"           AS form_timestamp,
  created_at,
  routed_at,
  routed_by,
  assigned_group,
  assigned_user,
  team_response,
  team_response_at,
  team_response_by,
  manager_response,
  manager_response_at,
  manager_response_by,
  justification,
  justification_at,
  justification_by,
  closed_at,
  closing_email_sent_at,
  last_activity_at,
  due_at
`;

function computeDueAt(priority: InquiryPriority, createdAt: Date): Date {
  const hours = PRIORITY_SLA_HOURS[priority] ?? PRIORITY_SLA_HOURS.medium;
  return new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
}

function groupLabelHe(group: string | null | undefined): string {
  if (!group) return '—';
  const normalized = group.toLowerCase() === 'teachers' ? 'morim' : group.toLowerCase();
  const match = DEFAULT_TARGET_GROUPS.find((g) => g.key.toLowerCase() === normalized);
  if (match) return match.label;
  if (normalized === 'morim') return 'מורים';
  return group;
}

interface ListInquiriesQuery {
  status?: InquiryStatus | InquiryStatus[];
  group?: string;
  groups?: string[];
  assignedUser?: string;
  priority?: InquiryPriority;
  search?: string;
  limit?: number;
  offset?: number;
  open?: boolean;
  /** Only open inquiries whose SLA deadline (due_at) has already passed. */
  overdue?: boolean;
  /** When provided, includes rows where assigned_user matches OR assigned_group is in user's groups. */
  inboxForUserEmail?: string;
  inboxForUserGroups?: string[];
}

export async function listInquiries(meta: DatasetMeta, query: ListInquiriesQuery) {
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);
  const offset = Math.max(query.offset || 0, 0);
  const where: string[] = [];
  const whereParams: unknown[] = [];

  function pushParam(value: unknown) {
    whereParams.push(value);
    return `$${whereParams.length}`;
  }

  // Rows without inquiry_id are sheet-only ghosts from db-smart sync — ignore them.
  where.push(`inquiry_id IS NOT NULL`);
  // Soft-deleted inquiries are hidden everywhere in the app.
  where.push(`deleted_at IS NULL`);

  if (query.open === true) {
    where.push(`status IN ('new','routed','awaiting_manager')`);
  } else if (query.open === false) {
    where.push(`status IN ('closed')`);
  }

  if (query.overdue) {
    where.push(`status IN ('new','routed','awaiting_manager')`);
    where.push(`due_at IS NOT NULL AND due_at < NOW()`);
  }

  if (query.status) {
    const list = Array.isArray(query.status) ? query.status : [query.status];
    where.push(`status = ANY(${pushParam(list)})`);
  }
  if (query.group) where.push(`assigned_group = ${pushParam(query.group)}`);
  if (query.groups && query.groups.length) {
    where.push(`assigned_group = ANY(${pushParam(query.groups)})`);
  }
  if (query.assignedUser) where.push(`LOWER(assigned_user) = LOWER(${pushParam(query.assignedUser)})`);
  if (query.priority) where.push(`priority = ${pushParam(query.priority)}`);
  if (query.search) {
    const term = `%${query.search.trim()}%`;
    where.push(`(title ILIKE ${pushParam(term)} OR description ILIKE ${pushParam(term)} OR full_name ILIKE ${pushParam(term)})`);
  }
  if (query.inboxForUserEmail) {
    const conditions: string[] = [`LOWER(assigned_user) = LOWER(${pushParam(query.inboxForUserEmail)})`];
    if (query.inboxForUserGroups && query.inboxForUserGroups.length) {
      conditions.push(`assigned_group = ANY(${pushParam(query.inboxForUserGroups)})`);
    }
    where.push(`(${conditions.join(' OR ')})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const table = quoteIdent(meta.tableName);
  const dedupedFrom = `
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY ${INQUIRY_DEDUPE_PARTITION}
      ORDER BY ${INQUIRY_DEDUPE_ORDER}
    ) AS _dedupe_rank
    FROM ${table}
    ${whereSql}`;
  const countSql = `SELECT COUNT(*)::int AS total FROM (${dedupedFrom}) deduped WHERE deduped._dedupe_rank = 1`;
  const rowsSql = `SELECT ${INQUIRY_SELECT}
                   FROM (${dedupedFrom}) deduped
                   WHERE deduped._dedupe_rank = 1
                   ORDER BY ${inquiryListOrderSql('deduped')}
                   LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`;

  const [countRes, rowsRes] = await Promise.all([
    pool.query<{ total: number }>(countSql, whereParams),
    pool.query<InquiryRow>(rowsSql, [...whereParams, limit, offset]),
  ]);

  return {
    rows: rowsRes.rows,
    pagination: { limit, offset, total: countRes.rows[0]?.total ?? 0 },
  };
}

export async function getInquiry(meta: DatasetMeta, inquiryId: string): Promise<InquiryRow | null> {
  const res = await pool.query<InquiryRow>(
    `SELECT ${INQUIRY_SELECT} FROM ${quoteIdent(meta.tableName)} WHERE inquiry_id = $1 AND deleted_at IS NULL`,
    [inquiryId],
  );
  return res.rows[0] ?? null;
}

/**
 * Soft-delete an inquiry: hide it (and its near-duplicate siblings) from the app.
 *
 * Why soft and not a hard DELETE: the row lives in the db-smart dataset table, which is
 * synced from the Google Form. A hard delete only removes the local row, so the next
 * Sheet→DB sync re-inserts it from the still-present form response (as a fresh "new" row) and
 * the complaint reappears. Keeping the row but stamping deleted_at means the sync sees a PK
 * conflict and only updates the sheet columns — deleted_at (a workflow column the sync never
 * touches) is preserved, so the inquiry stays hidden.
 *
 * We hide the whole (email, title, description) duplicate group — the same partition the list
 * view dedups on — so a sibling copy can't take the deleted one's place. Messages and history
 * are kept (soft delete is reversible by clearing deleted_at).
 */
export async function deleteInquiry(
  meta: DatasetMeta,
  inquiryId: string,
  actorEmail: string,
): Promise<{ subject: string; hidden: number } | null> {
  const existing = await getInquiry(meta, inquiryId);
  if (!existing) return null;
  const table = quoteIdent(meta.tableName);
  const targetSub = (expr: string) => `(SELECT ${expr} FROM ${table} WHERE inquiry_id = $1)`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<{ inquiry_id: string }>(
      `UPDATE ${table}
          SET deleted_at = NOW(), deleted_by = $2
        WHERE deleted_at IS NULL
          AND LOWER(TRIM(email)) IS NOT DISTINCT FROM ${targetSub('LOWER(TRIM(email))')}
          AND title IS NOT DISTINCT FROM ${targetSub('title')}
          AND ${INQUIRY_DEDUPE_DESCRIPTION_KEY} IS NOT DISTINCT FROM ${targetSub(INQUIRY_DEDUPE_DESCRIPTION_KEY)}
        RETURNING inquiry_id`,
      [inquiryId, actorEmail],
    );
    await logHistory(client, inquiryId, actorEmail, HISTORY_ACTION.DELETED, { hidden: res.rowCount });
    await client.query('COMMIT');
    return { subject: existing.subject, hidden: res.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mapping from "logical" workflow names to the actual underlying column names.
 * Only workflow columns are present here — sheet-managed columns must never be UPDATEd.
 */
const WRITABLE_COLUMNS = new Set([
  'status',
  'priority',
  'routed_at',
  'routed_by',
  'assigned_group',
  'assigned_user',
  'team_response',
  'team_response_at',
  'team_response_by',
  'manager_response',
  'manager_response_at',
  'manager_response_by',
  'justification',
  'justification_at',
  'justification_by',
  'closed_at',
  'closing_email_sent_at',
  'last_activity_at',
  'due_at',
  'sla_reminded_at',
]);

async function patchInquiry(
  meta: DatasetMeta,
  inquiryId: string,
  patch: Record<string, unknown>,
): Promise<InquiryRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  patch.last_activity_at = new Date().toISOString();
  for (const [name, value] of Object.entries(patch)) {
    if (!WRITABLE_COLUMNS.has(name)) continue;
    sets.push(`${quoteIdent(name)} = $${i++}`);
    values.push(value);
  }
  if (!sets.length) return getInquiry(meta, inquiryId);
  values.push(inquiryId);
  await pool.query(
    `UPDATE ${quoteIdent(meta.tableName)} SET ${sets.join(', ')} WHERE inquiry_id = $${i}`,
    values,
  );
  return getInquiry(meta, inquiryId);
}

export interface RouteInquiryInput {
  group: string;
  assignedUser: string | null;
  assignedUserLabel?: string | null;
  routedBy: string;
  /** When true, status jumps to awaiting_manager (skips team response). */
  routeToManager: boolean;
}

export async function routeInquiry(
  meta: DatasetMeta,
  inquiryId: string,
  input: RouteInquiryInput,
): Promise<InquiryRow | null> {
  const previous = await getInquiry(meta, inquiryId);
  if (!previous) return null;
  const wasRouted = !!previous.assigned_group;
  const now = new Date().toISOString();
  const nextStatus: InquiryStatus = input.routeToManager ? STATUS.AWAITING_MANAGER : STATUS.ROUTED;
  const updated = await patchInquiry(meta, inquiryId, {
    status: nextStatus,
    assigned_group: input.group,
    assigned_user: input.assignedUser,
    routed_at: now,
    routed_by: input.routedBy,
  });
  await logHistory(
    pool,
    inquiryId,
    input.routedBy,
    wasRouted ? HISTORY_ACTION.REROUTED : HISTORY_ACTION.ROUTED,
    {
      from_group: previous.assigned_group,
      to_group: input.group,
      assigned_user: input.assignedUser,
      route_to_manager: input.routeToManager,
    },
  );
  await postMessage(
    pool,
    inquiryId,
    input.routedBy,
    null,
    input.routeToManager
      ? `הפנייה שויכה ל-${input.assignedUserLabel || humanizeIdentifier(input.assignedUser || '')} (מד"ר / מנהל בית ספר) ועוברת להתייחסות סופית, בלי תגובת גורם מטפל.`
      : input.assignedUser
        ? `הפנייה נותבה לקבוצה "${groupLabelHe(input.group)}" ושויכה ל-${input.assignedUserLabel || humanizeIdentifier(input.assignedUser)}.`
        : `הפנייה נותבה לקבוצה "${groupLabelHe(input.group)}".`,
    MESSAGE_TYPE.ROUTING,
  );
  return updated;
}

export async function submitTeamResponse(
  meta: DatasetMeta,
  inquiryId: string,
  content: string,
  actorEmail: string,
  actorName: string | null,
): Promise<InquiryRow | null> {
  const trimmed = content.trim();
  if (!trimmed) return getInquiry(meta, inquiryId);
  const now = new Date().toISOString();
  const updated = await patchInquiry(meta, inquiryId, {
    status: STATUS.AWAITING_MANAGER,
    team_response: trimmed,
    team_response_at: now,
    team_response_by: actorEmail,
  });
  await logHistory(pool, inquiryId, actorEmail, HISTORY_ACTION.TEAM_RESPONSE_SUBMITTED, {});
  await postMessage(pool, inquiryId, actorEmail, actorName, trimmed, MESSAGE_TYPE.TEAM_RESPONSE);
  return updated;
}

export async function submitManagerResponse(
  meta: DatasetMeta,
  inquiryId: string,
  content: string,
  justification: JustificationDecision,
  actorEmail: string,
  actorName: string | null,
): Promise<InquiryRow | null> {
  const trimmed = content.trim();
  if (!trimmed) return getInquiry(meta, inquiryId);
  if (justification !== JUSTIFICATION.JUSTIFIED && justification !== JUSTIFICATION.UNJUSTIFIED) {
    throw new Error('justification must be "justified" or "unjustified"');
  }
  const now = new Date().toISOString();
  const updated = await patchInquiry(meta, inquiryId, {
    status: STATUS.CLOSED,
    manager_response: trimmed,
    manager_response_at: now,
    manager_response_by: actorEmail,
    justification,
    justification_at: now,
    justification_by: actorEmail,
    closed_at: now,
  });
  await logHistory(pool, inquiryId, actorEmail, HISTORY_ACTION.MANAGER_RESPONSE_SUBMITTED, { justification });
  await logHistory(pool, inquiryId, actorEmail, HISTORY_ACTION.CLOSED, { justification });
  await postMessage(pool, inquiryId, actorEmail, actorName, trimmed, MESSAGE_TYPE.MANAGER_RESPONSE);
  return updated;
}

/**
 * Set or change the justification on an inquiry — used for legacy rows that
 * were closed before this field existed, or to correct a manager's decision.
 */
export async function setJustification(
  meta: DatasetMeta,
  inquiryId: string,
  justification: JustificationDecision,
  actorEmail: string,
): Promise<InquiryRow | null> {
  if (justification !== JUSTIFICATION.JUSTIFIED && justification !== JUSTIFICATION.UNJUSTIFIED) {
    throw new Error('justification must be "justified" or "unjustified"');
  }
  const now = new Date().toISOString();
  const updated = await patchInquiry(meta, inquiryId, {
    justification,
    justification_at: now,
    justification_by: actorEmail,
  });
  await logHistory(pool, inquiryId, actorEmail, HISTORY_ACTION.JUSTIFICATION_SET, { justification });
  return updated;
}

export async function markClosingEmailSent(meta: DatasetMeta, inquiryId: string): Promise<void> {
  await patchInquiry(meta, inquiryId, { closing_email_sent_at: new Date().toISOString() });
  await logHistory(pool, inquiryId, 'system', HISTORY_ACTION.CLOSING_EMAIL_SENT, {});
}

export async function reopenInquiry(
  meta: DatasetMeta,
  inquiryId: string,
  actorEmail: string,
  note?: string,
): Promise<InquiryRow | null> {
  const updated = await patchInquiry(meta, inquiryId, {
    status: STATUS.AWAITING_MANAGER,
    closed_at: null,
    closing_email_sent_at: null,
    // Let the SLA sweep re-evaluate this now-active inquiry.
    sla_reminded_at: null,
  });
  await logHistory(pool, inquiryId, actorEmail, HISTORY_ACTION.REOPENED, { note });
  if (note) await postMessage(pool, inquiryId, actorEmail, null, note, MESSAGE_TYPE.STATUS_CHANGE);
  return updated;
}

/**
 * Workflow timestamp columns an admin/manager may retroactively correct via the
 * hidden date editor on the inquiry screen. Sheet-managed columns (e.g. the raw
 * form "timestamp") are intentionally excluded — only workflow columns are safe
 * to overwrite, since the db-smart sync never touches them.
 */
export const EDITABLE_DATE_COLUMNS = [
  'created_at',
  'due_at',
  'routed_at',
  'team_response_at',
  'manager_response_at',
  'justification_at',
  'closed_at',
  'closing_email_sent_at',
] as const;

export type EditableDateColumn = (typeof EDITABLE_DATE_COLUMNS)[number];

const EDITABLE_DATE_SET = new Set<string>(EDITABLE_DATE_COLUMNS);

/**
 * Retroactively edit one or more workflow dates on an inquiry. Each value may be
 * an ISO string / date-parseable string to set, or null/'' to clear the column.
 * Unlike the normal workflow mutations, this deliberately does NOT bump
 * last_activity_at — a data correction shouldn't reshuffle the inbox ordering.
 */
export async function updateInquiryDates(
  meta: DatasetMeta,
  inquiryId: string,
  dates: Record<string, string | null | undefined>,
  actorEmail: string,
): Promise<InquiryRow | null> {
  const previous = await getInquiry(meta, inquiryId);
  if (!previous) return null;

  const sets: string[] = [];
  const values: unknown[] = [];
  const changed: Record<string, { from: unknown; to: string | null }> = {};
  let i = 1;

  for (const [name, raw] of Object.entries(dates)) {
    if (!EDITABLE_DATE_SET.has(name)) continue;
    let iso: string | null = null;
    if (raw != null && String(raw).trim() !== '') {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        const err = new Error(`ערך תאריך לא חוקי בשדה "${name}"`);
        (err as { status?: number }).status = 400;
        throw err;
      }
      iso = d.toISOString();
    }
    sets.push(`${quoteIdent(name)} = $${i++}`);
    values.push(iso);
    changed[name] = { from: (previous as unknown as Record<string, unknown>)[name] ?? null, to: iso };
  }

  if (!sets.length) return previous;
  values.push(inquiryId);
  await pool.query(
    `UPDATE ${quoteIdent(meta.tableName)} SET ${sets.join(', ')} WHERE inquiry_id = $${i} AND deleted_at IS NULL`,
    values,
  );
  await logHistory(pool, inquiryId, actorEmail, HISTORY_ACTION.DATES_EDITED, { changed });
  return getInquiry(meta, inquiryId);
}

export async function changePriority(
  meta: DatasetMeta,
  inquiryId: string,
  priority: InquiryPriority,
  actor: string,
): Promise<InquiryRow | null> {
  const previous = await getInquiry(meta, inquiryId);
  if (!previous) return null;
  const created = new Date(previous.created_at);
  const due = computeDueAt(priority, created);
  // due_at moved → clear the reminder flag so a new breach against the new
  // deadline can alert again.
  const updated = await patchInquiry(meta, inquiryId, {
    priority,
    due_at: due.toISOString(),
    sla_reminded_at: null,
  });
  await logHistory(pool, inquiryId, actor, HISTORY_ACTION.PRIORITY_CHANGED, {
    from: previous.priority,
    to: priority,
  });
  return updated;
}

/* ------------------------------------------------------------------- */
/* Messages + history (auxiliary tables)                               */
/* ------------------------------------------------------------------- */

export async function listMessages(inquiryId: string): Promise<MessageRow[]> {
  const res = await pool.query<MessageRow>(
    `SELECT * FROM complaints_messages WHERE inquiry_id = $1 ORDER BY created_at ASC`,
    [inquiryId],
  );
  return res.rows;
}

export async function postMessage(
  poolOrClient: Pool | PoolClient,
  inquiryId: string,
  author: string,
  authorName: string | null,
  content: string,
  messageType: string = MESSAGE_TYPE.COMMENT,
): Promise<MessageRow> {
  const res = await poolOrClient.query<MessageRow>(
    `INSERT INTO complaints_messages (inquiry_id, author, author_name, content, message_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [inquiryId, author, authorName, content, messageType],
  );
  return res.rows[0];
}

export async function listHistory(inquiryId: string): Promise<HistoryRow[]> {
  const res = await pool.query<HistoryRow>(
    `SELECT * FROM complaints_history WHERE inquiry_id = $1 ORDER BY created_at ASC`,
    [inquiryId],
  );
  return res.rows;
}

export async function logHistory(
  poolOrClient: Pool | PoolClient,
  inquiryId: string,
  actor: string,
  action: HistoryAction,
  details: Record<string, unknown> = {},
): Promise<void> {
  await poolOrClient.query(
    `INSERT INTO complaints_history (inquiry_id, action, actor, details)
     VALUES ($1, $2, $3, $4)`,
    [inquiryId, action, actor, details],
  );
}

function dedupedTableSql(table: string, whereSql = ''): string {
  // Soft-deleted rows must never count toward stats.
  const base = whereSql.trim() ? `${whereSql} AND deleted_at IS NULL` : `WHERE deleted_at IS NULL`;
  return `(
    SELECT deduped.*
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY ${INQUIRY_DEDUPE_PARTITION}
        ORDER BY ${INQUIRY_DEDUPE_ORDER}
      ) AS _dedupe_rank
      FROM ${table}
      ${base}
    ) deduped
    WHERE deduped._dedupe_rank = 1
  ) inquiries`;
}

/** Named time-range for the stats dashboard. `all` disables the created_at filter entirely. */
export type StatsRange = 'all' | '7d' | '30d' | '90d';
const RANGE_DAYS: Record<Exclude<StatsRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

interface HeadlineCounts {
  total: number;
  closed: number;
  avgResolutionHours: number | null;
  slaMet: number; // closed inquiries whose closed_at was on/before due_at
  slaBreachedClosed: number; // closed inquiries whose closed_at was after due_at
}

/**
 * Aggregate counts for a single window (either the current range or the
 * previous, same-length window used for deltas). Everything else on the
 * dashboard reuses these numbers, so it's centralized here.
 */
async function fetchHeadline(dedupedTable: string, whereRange: string, params: unknown[]): Promise<HeadlineCounts> {
  const q = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
      AVG(EXTRACT(EPOCH FROM (closed_at - created_at))/3600)
        FILTER (WHERE closed_at IS NOT NULL)::float AS avg_hours,
      COUNT(*) FILTER (
        WHERE status = 'closed' AND closed_at IS NOT NULL
          AND (due_at IS NULL OR closed_at <= due_at)
      )::int AS sla_met,
      COUNT(*) FILTER (
        WHERE status = 'closed' AND closed_at IS NOT NULL
          AND due_at IS NOT NULL AND closed_at > due_at
      )::int AS sla_breached_closed
    FROM ${dedupedTable}
    ${whereRange}
  `;
  const r = await pool.query<{
    total: number;
    closed: number;
    avg_hours: number | null;
    sla_met: number;
    sla_breached_closed: number;
  }>(q, params);
  const row = r.rows[0];
  return {
    total: row?.total ?? 0,
    closed: row?.closed ?? 0,
    avgResolutionHours: row?.avg_hours ?? null,
    slaMet: row?.sla_met ?? 0,
    slaBreachedClosed: row?.sla_breached_closed ?? 0,
  };
}

export async function getStats(meta: DatasetMeta, range: StatsRange = 'all') {
  const table = quoteIdent(meta.tableName);
  const deduped = dedupedTableSql(table);

  // Build range clauses. `whereRange` filters by `created_at` (the semantic
  // "the inquiry belongs to this period") — everything else derives from that.
  let whereRange = '';
  let whereRangePrev = '';
  const rangeParams: unknown[] = [];
  const prevParams: unknown[] = [];
  let periodStartIso: string | null = null;
  let periodEndIso: string | null = null;
  if (range !== 'all') {
    const days = RANGE_DAYS[range];
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const prevStart = new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
    whereRange = `WHERE created_at >= $1 AND created_at <= $2`;
    whereRangePrev = `WHERE created_at >= $1 AND created_at < $2`;
    rangeParams.push(start.toISOString(), now.toISOString());
    prevParams.push(prevStart.toISOString(), start.toISOString());
    periodStartIso = start.toISOString();
    periodEndIso = now.toISOString();
  }

  const trendPlan = planTrend(range);

  const [
    headline,
    previous,
    byStatus,
    byPriority,
    byGroup,
    byCategory,
    byJustification,
    slaBreachesOpen,
    reopened,
    stageTimings,
    backlogAge,
    topReporters,
    createdTrend,
    closedTrend,
  ] = await Promise.all([
    fetchHeadline(deduped, whereRange, rangeParams),
    range === 'all' ? Promise.resolve<HeadlineCounts | null>(null) : fetchHeadline(deduped, whereRangePrev, prevParams),
    pool.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count FROM ${deduped} ${whereRange} GROUP BY status`,
      rangeParams,
    ),
    pool.query<{ priority: string; count: number }>(
      `SELECT priority, COUNT(*)::int AS count FROM ${deduped} ${whereRange} GROUP BY priority`,
      rangeParams,
    ),
    pool.query<{ assigned_group: string | null; count: number }>(
      `SELECT assigned_group, COUNT(*)::int AS count FROM ${deduped} ${whereRange} GROUP BY assigned_group`,
      rangeParams,
    ),
    pool.query<{ category: string | null; count: number }>(
      `SELECT request_category AS category, COUNT(*)::int AS count FROM ${deduped} ${whereRange} GROUP BY request_category`,
      rangeParams,
    ),
    pool.query<{ justification: string | null; count: number }>(
      `SELECT justification, COUNT(*)::int AS count FROM ${deduped}
        ${whereRange ? `${whereRange} AND` : 'WHERE'} status = 'closed'
        GROUP BY justification`,
      rangeParams,
    ),
    // Currently-open + past-due. Semantically a "now" metric — but we still scope
    // it to the range (inquiries created in the window) so it aligns with the header KPIs.
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${deduped}
        ${whereRange ? `${whereRange} AND` : 'WHERE'}
          due_at IS NOT NULL AND due_at < NOW() AND status <> 'closed'`,
      rangeParams,
    ),
    // Reopened count from the audit log — an inquiry can be reopened multiple times;
    // we count *events* (one per reopen). Scope by history.created_at when a range is set.
    pool.query<{ count: number }>(
      range === 'all'
        ? `SELECT COUNT(*)::int AS count FROM complaints_history WHERE action = 'reopened'`
        : `SELECT COUNT(*)::int AS count FROM complaints_history
            WHERE action = 'reopened' AND created_at >= $1 AND created_at <= $2`,
      rangeParams,
    ),
    pool.query<{
      avg_route_hours: number | null;
      med_route_hours: number | null;
      avg_team_hours: number | null;
      med_team_hours: number | null;
      avg_manager_hours: number | null;
      med_manager_hours: number | null;
      median_resolution_hours: number | null;
      p90_resolution_hours: number | null;
      closing_email_sent: number;
    }>(
      `SELECT
          AVG(EXTRACT(EPOCH FROM (routed_at - created_at))/3600)
            FILTER (WHERE routed_at IS NOT NULL AND routed_at >= created_at)::float AS avg_route_hours,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (routed_at - created_at))/3600
          ) FILTER (WHERE routed_at IS NOT NULL AND routed_at >= created_at) AS med_route_hours,
          AVG(EXTRACT(EPOCH FROM (team_response_at - routed_at))/3600)
            FILTER (WHERE team_response_at IS NOT NULL AND routed_at IS NOT NULL AND team_response_at >= routed_at)::float AS avg_team_hours,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (team_response_at - routed_at))/3600
          ) FILTER (WHERE team_response_at IS NOT NULL AND routed_at IS NOT NULL AND team_response_at >= routed_at) AS med_team_hours,
          AVG(EXTRACT(EPOCH FROM (manager_response_at - team_response_at))/3600)
            FILTER (WHERE manager_response_at IS NOT NULL AND team_response_at IS NOT NULL AND manager_response_at >= team_response_at)::float AS avg_manager_hours,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (manager_response_at - team_response_at))/3600
          ) FILTER (WHERE manager_response_at IS NOT NULL AND team_response_at IS NOT NULL AND manager_response_at >= team_response_at) AS med_manager_hours,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (closed_at - created_at))/3600
          ) FILTER (WHERE closed_at IS NOT NULL) AS median_resolution_hours,
          PERCENTILE_CONT(0.9) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (closed_at - created_at))/3600
          ) FILTER (WHERE closed_at IS NOT NULL) AS p90_resolution_hours,
          COUNT(*) FILTER (WHERE closing_email_sent_at IS NOT NULL)::int AS closing_email_sent
        FROM ${deduped}
        ${whereRange}`,
      rangeParams,
    ),
    // Age buckets for currently-open inquiries. Always computed "as of NOW",
    // constrained to the range window when one is selected.
    pool.query<{
      bucket_0_1: number;
      bucket_1_3: number;
      bucket_3_7: number;
      bucket_7_14: number;
      bucket_14_plus: number;
    }>(
      `SELECT
          COUNT(*) FILTER (WHERE age_days < 1)::int AS bucket_0_1,
          COUNT(*) FILTER (WHERE age_days >= 1 AND age_days < 3)::int AS bucket_1_3,
          COUNT(*) FILTER (WHERE age_days >= 3 AND age_days < 7)::int AS bucket_3_7,
          COUNT(*) FILTER (WHERE age_days >= 7 AND age_days < 14)::int AS bucket_7_14,
          COUNT(*) FILTER (WHERE age_days >= 14)::int AS bucket_14_plus
        FROM (
          SELECT EXTRACT(EPOCH FROM (NOW() - created_at))/86400 AS age_days
            FROM ${deduped}
            ${whereRange ? `${whereRange} AND` : 'WHERE'} status <> 'closed'
        ) ages`,
      rangeParams,
    ),
    // Top reporters (by total inquiries in the range). Grouped case-insensitively
    // on email; `full_name` is picked from an arbitrary sample row for display.
    pool.query<{ email: string; full_name: string | null; total: number; open: number }>(
      `SELECT
          LOWER(TRIM(email)) AS email,
          MAX(NULLIF(TRIM(full_name), '')) AS full_name,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status <> 'closed')::int AS open
        FROM ${deduped}
        ${whereRange ? `${whereRange} AND` : 'WHERE'} email IS NOT NULL AND TRIM(email) <> ''
        GROUP BY LOWER(TRIM(email))
        ORDER BY total DESC, open DESC
        LIMIT 5`,
      rangeParams,
    ),
    // Trend queries — bucketed by the granularity chosen for the current range.
    pool.query<{ bucket: string; count: number }>(
      `SELECT to_char(date_trunc('${trendPlan.pgUnit}', created_at), 'YYYY-MM-DD') AS bucket,
              COUNT(*)::int AS count
         FROM ${deduped}
        WHERE created_at >= $1
        GROUP BY 1 ORDER BY 1`,
      [trendPlan.since.toISOString()],
    ),
    pool.query<{ bucket: string; count: number }>(
      `SELECT to_char(date_trunc('${trendPlan.pgUnit}', closed_at), 'YYYY-MM-DD') AS bucket,
              COUNT(*)::int AS count
         FROM ${deduped}
        WHERE closed_at IS NOT NULL AND closed_at >= $1
        GROUP BY 1 ORDER BY 1`,
      [trendPlan.since.toISOString()],
    ),
  ]);

  // Fill missing buckets so the trend chart draws a continuous line.
  const createdByBucket = new Map(createdTrend.rows.map((r) => [r.bucket, r.count]));
  const closedByBucket = new Map(closedTrend.rows.map((r) => [r.bucket, r.count]));
  const trend = trendPlan.buckets.map((key) => ({
    bucket: key,
    created: createdByBucket.get(key) ?? 0,
    closed: closedByBucket.get(key) ?? 0,
  }));

  const t = stageTimings.rows[0];
  const justificationCounts = new Map(byJustification.rows.map((r) => [r.justification, r.count]));
  const closedTotal = headline.closed;
  const closingEmailSent = t?.closing_email_sent ?? 0;
  const slaCompliancePct =
    closedTotal > 0
      ? Math.round(((headline.slaMet) / closedTotal) * 100)
      : null;

  const bucket = backlogAge.rows[0];

  return {
    range,
    periodStart: periodStartIso,
    periodEnd: periodEndIso,
    trendGranularity: trendPlan.granularity,
    headline: {
      total: headline.total,
      closed: headline.closed,
      open: headline.total - headline.closed,
      avgResolutionHours: headline.avgResolutionHours,
      closingEmailSent,
      closingEmailSentPct: closedTotal > 0 ? Math.round((closingEmailSent / closedTotal) * 100) : null,
      slaMet: headline.slaMet,
      slaBreachedClosed: headline.slaBreachedClosed,
      slaCompliancePct,
      slaBreachesOpen: slaBreachesOpen.rows[0]?.count ?? 0,
      reopenedCount: reopened.rows[0]?.count ?? 0,
      justifiedCount: justificationCounts.get('justified') ?? 0,
      unjustifiedCount: justificationCounts.get('unjustified') ?? 0,
      pendingJustificationCount: justificationCounts.get(null) ?? 0,
    },
    previous: previous
      ? {
          total: previous.total,
          closed: previous.closed,
          avgResolutionHours: previous.avgResolutionHours,
          slaMet: previous.slaMet,
          slaCompliancePct:
            previous.closed > 0 ? Math.round((previous.slaMet / previous.closed) * 100) : null,
        }
      : null,
    byStatus: byStatus.rows,
    byPriority: byPriority.rows,
    byGroup: byGroup.rows,
    byCategory: byCategory.rows,
    backlogAge: {
      lt1d: bucket?.bucket_0_1 ?? 0,
      d1to3: bucket?.bucket_1_3 ?? 0,
      d3to7: bucket?.bucket_3_7 ?? 0,
      d7to14: bucket?.bucket_7_14 ?? 0,
      d14plus: bucket?.bucket_14_plus ?? 0,
    },
    topReporters: topReporters.rows,
    timings: {
      avgRouteHours: t?.avg_route_hours ?? null,
      medRouteHours: t?.med_route_hours ?? null,
      avgTeamHours: t?.avg_team_hours ?? null,
      medTeamHours: t?.med_team_hours ?? null,
      avgManagerHours: t?.avg_manager_hours ?? null,
      medManagerHours: t?.med_manager_hours ?? null,
      medianResolutionHours: t?.median_resolution_hours ?? null,
      p90ResolutionHours: t?.p90_resolution_hours ?? null,
    },
    // Kept as `trend` for backwards-compat, with an extra `bucket` field alongside `week`.
    trend: trend.map((t) => ({ week: t.bucket, bucket: t.bucket, created: t.created, closed: t.closed })),
  };
}

interface TrendPlan {
  granularity: 'day' | 'week';
  pgUnit: 'day' | 'week';
  since: Date;
  buckets: string[]; // sorted oldest → newest, ISO date "YYYY-MM-DD"
}

/**
 * Pick a sensible bucket size for the trend chart based on the selected range.
 *   7d  → 7 daily buckets
 *   30d → 30 daily buckets
 *   90d → ~13 weekly buckets
 *   all → 12 weekly buckets (backwards-compatible)
 */
function planTrend(range: StatsRange): TrendPlan {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (range === '7d' || range === '30d') {
    const days = range === '7d' ? 7 : 30;
    const buckets: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      buckets.push(d.toISOString().slice(0, 10));
    }
    const since = new Date(today);
    since.setUTCDate(today.getUTCDate() - (days - 1));
    return { granularity: 'day', pgUnit: 'day', since, buckets };
  }
  // 90d / all → weekly buckets. 90d → 13 weeks, all → 12 weeks.
  const weeks = range === '90d' ? 13 : 12;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const buckets: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() - i * 7);
    buckets.push(d.toISOString().slice(0, 10));
  }
  const since = new Date(monday);
  since.setUTCDate(monday.getUTCDate() - (weeks - 1) * 7);
  return { granularity: 'week', pgUnit: 'week', since, buckets };
}

export type { InquiryRow };
