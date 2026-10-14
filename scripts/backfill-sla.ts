/**
 * One-shot: reset `due_at` on all OPEN inquiries to `created_at + 7 days`
 * (matches the new uniform SLA in `lib/constants.ts` / `lib/schema.ts`).
 *
 * Closed inquiries are left alone — their `due_at` is historical (what the
 * deadline *was* at the time), which we still need for the SLA-compliance
 * stat ("was it closed on time?"). Touching them would rewrite history.
 *
 * We also clear `sla_reminded_at` for rows that are no longer overdue after
 * the update, so the reminder scheduler will re-arm and only re-alert if the
 * (new, wider) deadline is missed again.
 *
 * Usage:
 *   npm run backfill-sla -- --dry-run
 *   npm run backfill-sla -- --yes
 */
import 'dotenv/config';
import { pool } from '../config/db.ts';
import { loadDatasetMeta } from '../services/datasetMeta.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';

const SLA_INTERVAL = "INTERVAL '7 days'";
const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--yes');

async function main() {
  const datasetId = process.env.COMPLAINTS_DATASET_ID;
  if (!datasetId) {
    console.error('COMPLAINTS_DATASET_ID is not set.');
    process.exit(1);
  }
  const meta = await loadDatasetMeta(datasetId, pool);
  if (!meta) {
    console.error(`Dataset ${datasetId} not found.`);
    process.exit(1);
  }
  const table = quoteIdent(meta.tableName);

  // Preview: how many rows would change, and how many are currently overdue
  // (which affects the "reminded" reset below).
  const preview = await pool.query<{
    total: number;
    would_change: number;
    now_overdue_before: number;
    now_overdue_after: number;
    reminded: number;
  }>(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE due_at IS DISTINCT FROM (created_at + ${SLA_INTERVAL})
        )::int AS would_change,
        COUNT(*) FILTER (WHERE due_at IS NOT NULL AND due_at < NOW())::int AS now_overdue_before,
        COUNT(*) FILTER (WHERE (created_at + ${SLA_INTERVAL}) < NOW())::int AS now_overdue_after,
        COUNT(*) FILTER (WHERE sla_reminded_at IS NOT NULL)::int AS reminded
      FROM ${table}
      WHERE deleted_at IS NULL
        AND inquiry_id IS NOT NULL
        AND status <> 'closed'`,
  );
  const p = preview.rows[0];

  const prefix = dryRun ? '[DRY RUN] ' : confirmed ? '' : '[PLAN] ';
  console.log(`${prefix}Open inquiries: ${p.total}`);
  console.log(`${prefix}  • due_at rows to rewrite: ${p.would_change}`);
  console.log(`${prefix}  • overdue before update:  ${p.now_overdue_before}`);
  console.log(`${prefix}  • overdue after update:   ${p.now_overdue_after}`);
  console.log(`${prefix}  • previously reminded:    ${p.reminded}`);

  if (!confirmed) {
    console.log('\nNothing was changed. Re-run with --yes to execute (or --dry-run for a preview).');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let updated = 0;
  let cleared = 0;
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE ${table}
          SET due_at = created_at + ${SLA_INTERVAL}
        WHERE deleted_at IS NULL
          AND inquiry_id IS NOT NULL
          AND status <> 'closed'
          AND due_at IS DISTINCT FROM (created_at + ${SLA_INTERVAL})`,
    );
    updated = upd.rowCount ?? 0;

    // Rows that were "reminded" but are no longer overdue → clear the flag so
    // the reminder scheduler will notify again if they slip past the new deadline.
    const clr = await client.query(
      `UPDATE ${table}
          SET sla_reminded_at = NULL
        WHERE deleted_at IS NULL
          AND inquiry_id IS NOT NULL
          AND status <> 'closed'
          AND sla_reminded_at IS NOT NULL
          AND due_at >= NOW()`,
    );
    cleared = clr.rowCount ?? 0;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nDone.`);
  console.log(`  • Rows re-based to 7-day SLA: ${updated}`);
  console.log(`  • Reminder flags reset:        ${cleared}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
