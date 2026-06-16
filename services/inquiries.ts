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
import { INQUIRY_DEDUPE_ORDER, INQUIRY_DEDUPE_PARTITION, inquiryListOrderSql } from '../lib/inquiryDedupe.ts';
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
    `SELECT ${INQUIRY_SELECT} FROM ${quoteIdent(meta.tableName)} WHERE inquiry_id = $1`,
    [inquiryId],
  );
  return res.rows[0] ?? null;
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
      ? `הפנייה נותבה ישירות למנהל (קבוצה: ${groupLabelHe(input.group)}${input.assignedUser ? `, מטפל: ${input.assignedUserLabel || humanizeIdentifier(input.assignedUser)}` : ''}).`
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
  return `(
    SELECT deduped.*
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY ${INQUIRY_DEDUPE_PARTITION}
        ORDER BY ${INQUIRY_DEDUPE_ORDER}
      ) AS _dedupe_rank
      FROM ${table}
      ${whereSql}
    ) deduped
    WHERE deduped._dedupe_rank = 1
  ) inquiries`;
}

export async function getStats(meta: DatasetMeta) {
  const table = quoteIdent(meta.tableName);
  const deduped = dedupedTableSql(table);
  const [byStatus, byPriority, byGroup, slaBreaches, avgResolution] = await Promise.all([
    pool.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count FROM ${deduped} GROUP BY status`,
    ),
    pool.query<{ priority: string; count: number }>(
      `SELECT priority, COUNT(*)::int AS count FROM ${deduped} GROUP BY priority`,
    ),
    pool.query<{ assigned_group: string | null; count: number }>(
      `SELECT assigned_group, COUNT(*)::int AS count FROM ${deduped} GROUP BY assigned_group`,
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${deduped}
        WHERE due_at IS NOT NULL AND due_at < NOW()
          AND status NOT IN ('closed')`,
    ),
    pool.query<{ avg_hours: number | null }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (closed_at - created_at))/3600)::float AS avg_hours
         FROM ${deduped} WHERE closed_at IS NOT NULL`,
    ),
  ]);

  return {
    byStatus: byStatus.rows,
    byPriority: byPriority.rows,
    byGroup: byGroup.rows,
    slaBreaches: slaBreaches.rows[0]?.count ?? 0,
    avgResolutionHours: avgResolution.rows[0]?.avg_hours ?? null,
  };
}

export type { InquiryRow };
