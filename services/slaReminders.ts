import { pool } from '../config/db.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';
import {
  STATUS,
  HISTORY_ACTION,
  STATUS_LABEL_HE,
  DEFAULT_MANAGER_ROLE_KEYS,
  type InquiryStatus,
} from '../lib/constants.ts';
import type { DatasetMeta } from '../lib/types.ts';
import { listManagers, listNavigators } from './userDirectory.ts';
import { sendNotification, notifyGroup } from './notifications.ts';
import { logHistory } from './inquiries.ts';

/**
 * SLA reminders.
 *
 * A lightweight in-process scheduler that periodically scans the dataset for
 * OPEN inquiries whose `due_at` has passed and that haven't been reminded yet.
 * For each breach it notifies whoever is currently responsible, stamps
 * `sla_reminded_at` so it never double-notifies, and records a history entry.
 *
 * Delivery relies on the Beast notifications API, so the sweep is a no-op when
 * `BEAST_API_KEY` isn't configured (nothing could be delivered anyway).
 */

interface BreachRow {
  inquiry_id: string;
  subject: string | null;
  status: InquiryStatus;
  assigned_user: string | null;
  assigned_group: string | null;
}

function managerRoleKeys(): string[] {
  const env = (process.env.MANAGER_ROLE_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return env.length ? env : DEFAULT_MANAGER_ROLE_KEYS;
}

/** Resolve the recipients (specific users and/or a group) for one breached inquiry. */
async function resolveRecipients(row: BreachRow): Promise<{ users: string[]; group: string | null }> {
  const adminGroup = process.env.ADMIN_GROUP || 'tichnun';

  if (row.status === STATUS.AWAITING_MANAGER) {
    const managers = await listManagers({ adminGroup, roleKeys: managerRoleKeys() });
    return { users: managers.map((m) => m.email || `${m.username}@local`), group: null };
  }

  if (row.status === STATUS.ROUTED) {
    if (row.assigned_user) return { users: [row.assigned_user], group: null };
    return { users: [], group: row.assigned_group };
  }

  // status === NEW (still unrouted) → alert whoever can route it.
  const navigators = await listNavigators({
    adminGroup,
    navigatorRoleKey: process.env.NAVIGATOR_ROLE_KEY || 'naat_pniot_lakoach',
    kevaGroup: process.env.KEVA_GROUP || 'keva',
  });
  return { users: navigators.map((m) => m.email || `${m.username}@local`), group: null };
}

/**
 * Run a single sweep. Returns the number of inquiries flagged.
 * Safe to call repeatedly — only un-reminded, overdue, open rows are picked up.
 */
export async function runSlaReminderSweep(meta: DatasetMeta, limit = 200): Promise<number> {
  const table = quoteIdent(meta.tableName);
  const { rows } = await pool.query<BreachRow>(
    `SELECT inquiry_id, title AS subject, status, assigned_user, assigned_group
       FROM ${table}
      WHERE inquiry_id IS NOT NULL
        AND deleted_at IS NULL
        AND status IN ('new','routed','awaiting_manager')
        AND due_at IS NOT NULL
        AND due_at < NOW()
        AND sla_reminded_at IS NULL
      ORDER BY due_at ASC
      LIMIT $1`,
    [limit],
  );

  for (const row of rows) {
    try {
      const { users, group } = await resolveRecipients(row);
      const payload = {
        title: 'פנייה חרגה מיעד הטיפול',
        message: `${row.subject || 'פנייה'} — ${STATUS_LABEL_HE[row.status] || row.status}`,
        link: `/inquiries/${row.inquiry_id}`,
        type: 'warning' as const,
      };

      if (group && !users.length) {
        await notifyGroup(row.inquiry_id, group, payload);
      } else {
        const unique = Array.from(new Set(users.filter(Boolean)));
        await Promise.all(
          unique.map((u) => sendNotification(row.inquiry_id, u, payload).catch(() => undefined)),
        );
      }

      // Stamp regardless of delivery success so we never loop on the same row.
      await pool.query(`UPDATE ${table} SET sla_reminded_at = NOW() WHERE inquiry_id = $1`, [
        row.inquiry_id,
      ]);
      await logHistory(pool, row.inquiry_id, 'system', HISTORY_ACTION.SLA_BREACH, {
        status: row.status,
      });
    } catch (err) {
      console.warn(
        `[beast-complaints] SLA reminder failed for ${row.inquiry_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return rows.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Start the periodic SLA sweep. Interval is configurable via
 * `SLA_REMINDER_INTERVAL_MINUTES` (default 60; set to 0 to disable).
 */
export function startSlaReminderScheduler(meta: DatasetMeta): void {
  if (timer) return; // already started

  const minutes = parseInt(process.env.SLA_REMINDER_INTERVAL_MINUTES || '60', 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.info('[beast-complaints] SLA reminders disabled (SLA_REMINDER_INTERVAL_MINUTES=0).');
    return;
  }
  if (!process.env.BEAST_API_KEY) {
    console.info('[beast-complaints] SLA reminders inactive — BEAST_API_KEY missing (no delivery channel).');
    return;
  }

  const tick = async () => {
    if (running) return; // never overlap sweeps
    running = true;
    try {
      const count = await runSlaReminderSweep(meta);
      if (count > 0) console.log(`[beast-complaints] SLA sweep: ${count} overdue inqu. flagged.`);
    } catch (err) {
      console.warn('[beast-complaints] SLA sweep error:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };

  const intervalMs = minutes * 60 * 1000;
  timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === 'function') timer.unref(); // don't keep the process alive
  // First sweep shortly after startup (let the directory cache warm up first).
  setTimeout(() => void tick(), 30_000);
  console.log(`[beast-complaints] SLA reminders active (every ${minutes} min).`);
}
