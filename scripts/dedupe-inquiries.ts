/**
 * Remove near-duplicate inquiry rows created when Google Sheets sync and legacy
 * import both ingested the same form submission (timestamps differ by ~1 second).
 *
 * Keeps the row with the richest workflow state (legacy_id, closed status, etc.)
 * and deletes the stray copies. Auxiliary messages/history for deleted rows are
 * left orphaned — they point at UUIDs that no longer exist, which is acceptable
 * for one-shot duplicates that never had workflow activity.
 *
 * Usage:
 *   npm run dedupe-inquiries
 *   npm run dedupe-inquiries -- --dry-run
 */
import 'dotenv/config';
import { pool } from '../config/db.ts';
import { loadDatasetMeta } from '../services/datasetMeta.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';
import { INQUIRY_DEDUPE_ORDER, INQUIRY_DEDUPE_PARTITION } from '../lib/inquiryDedupe.ts';

const dryRun = process.argv.includes('--dry-run');

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
  const ranked = await pool.query<{
    inquiry_id: string;
    email: string | null;
    title: string | null;
    status: string | null;
    timestamp: string | null;
    legacy_id: string | null;
    _dedupe_rank: string;
  }>(`
    SELECT inquiry_id, email, title, status, "timestamp", legacy_id, _dedupe_rank
    FROM (
      SELECT inquiry_id, email, title, status, "timestamp", legacy_id,
             ROW_NUMBER() OVER (
               PARTITION BY ${INQUIRY_DEDUPE_PARTITION}
               ORDER BY ${INQUIRY_DEDUPE_ORDER}
             ) AS _dedupe_rank
      FROM ${table}
    ) ranked
    WHERE _dedupe_rank::int > 1
    ORDER BY email, title
  `);

  if (!ranked.rows.length) {
    console.log('No duplicate inquiry rows found.');
    await pool.end();
    return;
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Removing ${ranked.rows.length} duplicate row(s):\n`);
  for (const row of ranked.rows) {
    console.log(
      `  - ${row.inquiry_id}  ${row.status}  legacy=${row.legacy_id ?? '—'}  ${row.email}  "${row.title}"  (${row.timestamp})`,
    );
  }

  let deleted = 0;

  if (!dryRun && ranked.rows.length) {
    const ids = ranked.rows.map((r) => r.inquiry_id);
    const res = await pool.query(`DELETE FROM ${table} WHERE inquiry_id = ANY($1::uuid[])`, [ids]);
    deleted += res.rowCount ?? 0;
  } else {
    deleted += ranked.rows.length;
  }

  // Sheet-only ghosts recreated by db-smart sync (no inquiry_id / workflow columns).
  const ghosts = await pool.query<{ email: string; title: string; timestamp: string }>(`
    SELECT g.email, g.title, g."timestamp"
    FROM ${table} g
    WHERE g.inquiry_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM ${table} c
        WHERE c.inquiry_id IS NOT NULL
          AND LOWER(TRIM(c.email)) = LOWER(TRIM(g.email))
          AND c.title = g.title
      )
    ORDER BY g.email, g.title
  `);

  if (ghosts.rows.length) {
    console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Removing ${ghosts.rows.length} sheet-only ghost row(s):`);
    for (const row of ghosts.rows) {
      console.log(`  - ghost  ${row.email}  "${row.title}"  (${row.timestamp})`);
    }
    if (!dryRun) {
      const res = await pool.query(`
        DELETE FROM ${table} g
        WHERE g.inquiry_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM ${table} c
            WHERE c.inquiry_id IS NOT NULL
              AND LOWER(TRIM(c.email)) = LOWER(TRIM(g.email))
              AND c.title = g.title
          )
      `);
      deleted += res.rowCount ?? 0;
    } else {
      deleted += ghosts.rows.length;
    }
  }

  const after = await pool.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
  console.log(
    `\n${dryRun ? '[DRY RUN] ' : ''}Done. Removed ${deleted} row(s). Rows remaining: ${after.rows[0]?.cnt ?? '?'}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error('Dedupe failed:', err);
  process.exit(1);
});
