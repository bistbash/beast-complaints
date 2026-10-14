/**
 * One-shot: permanently hard-DELETE every OPEN inquiry (status IN
 * 'new', 'routed', 'awaiting_manager') from the db-smart dataset table and
 * their auxiliary rows (messages / history / notifications).
 *
 * The deletion of each dataset row goes through the db-smart HTTP API
 * (`DELETE /api/datasets/:datasetId/rows`) so the row is removed from the
 * Google Sheet as well. That is what stops the periodic Sheet→DB sync from
 * re-inserting the row a few minutes later.
 *
 * The auxiliary tables (`complaints_messages`, `complaints_history`,
 * `complaints_notifications`) are still cleaned up with a direct SQL DELETE —
 * they are internal to this app and never live in the Sheet.
 *
 * Required env vars:
 *   COMPLAINTS_DATASET_ID         db-smart dataset UUID
 *   DB_SMART_URL                  base URL, e.g. http://192.168.100.12:3004
 *   DB_SMART_DATASET_API_KEY      dataset API key (`dbs_…`), created in the
 *                                 db-smart UI under the dataset's API keys tab
 *
 * Usage:
 *   npm run purge-open-inquiries -- --dry-run
 *   npm run purge-open-inquiries -- --yes
 *
 * Neither flag → prints the plan and exits without doing anything.
 */
import 'dotenv/config';
import axios, { AxiosError } from 'axios';
import { pool } from '../config/db.ts';
import { loadDatasetMeta } from '../services/datasetMeta.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';

const OPEN_STATUSES = ['new', 'routed', 'awaiting_manager'] as const;

const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--yes');

// Max parallel Sheet+DB deletes. Kept low because each API call talks to the
// Google Sheets API (read + delete) and we do not want to trigger rate limits.
const DELETE_CONCURRENCY = 4;

function apiErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    const body = err.response?.data;
    const detail =
      typeof body === 'string'
        ? body
        : body?.error
          ? String(body.error)
          : body
            ? JSON.stringify(body)
            : err.message;
    return status ? `HTTP ${status}: ${detail}` : detail;
  }
  return err instanceof Error ? err.message : String(err);
}

type OpenInquiry = {
  inquiry_id: string;
  status: string | null;
  email: string | null;
  title: string | null;
  timestamp: string | null;
  created_at: string | null;
  assigned_group: string | null;
  assigned_user: string | null;
};

type DeleteOutcome = {
  inquiryId: string;
  ok: boolean;
  sheetDeleted: boolean;
  error?: string;
};

async function deleteRowViaApi(
  baseUrl: string,
  apiKey: string,
  datasetId: string,
  inquiryId: string,
): Promise<DeleteOutcome> {
  try {
    const res = await axios.request({
      method: 'DELETE',
      url: `${baseUrl.replace(/\/$/, '')}/api/datasets/${datasetId}/rows`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      data: { pk: { inquiry_id: inquiryId } },
      timeout: 30_000,
      validateStatus: () => true,
    });

    if (res.status === 404) {
      // Row already gone from db-smart (e.g. previous partial run). Treat as
      // success so the cascade cleanup can still proceed.
      return { inquiryId, ok: true, sheetDeleted: false };
    }
    if (res.status !== 200 || !res.data?.success) {
      return {
        inquiryId,
        ok: false,
        sheetDeleted: false,
        error: `HTTP ${res.status}: ${res.data?.error || 'delete failed'}`,
      };
    }
    return {
      inquiryId,
      ok: true,
      sheetDeleted: !!res.data.sheetDeleted,
    };
  } catch (err) {
    return { inquiryId, ok: false, sheetDeleted: false, error: apiErrorMessage(err) };
  }
}

async function deleteRowsViaApi(
  baseUrl: string,
  apiKey: string,
  datasetId: string,
  inquiryIds: string[],
): Promise<DeleteOutcome[]> {
  const results: DeleteOutcome[] = [];
  const queue = inquiryIds.slice();

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      const outcome = await deleteRowViaApi(baseUrl, apiKey, datasetId, id);
      results.push(outcome);
      const marker = outcome.ok ? (outcome.sheetDeleted ? '✓ sheet+db' : '✓ db only') : '✗';
      const detail = outcome.error ? ` — ${outcome.error}` : '';
      console.log(`  ${marker} ${id}${detail}`);
    }
  }

  const workers = Array.from({ length: Math.min(DELETE_CONCURRENCY, inquiryIds.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const datasetId = process.env.COMPLAINTS_DATASET_ID;
  if (!datasetId) {
    console.error('COMPLAINTS_DATASET_ID is not set.');
    process.exit(1);
  }

  const dbSmartUrl = process.env.DB_SMART_URL;
  const dbSmartApiKey = process.env.DB_SMART_DATASET_API_KEY;
  if (!dbSmartUrl || !dbSmartApiKey) {
    console.error(
      'DB_SMART_URL and DB_SMART_DATASET_API_KEY must be set so the Sheet is cleaned up too.\n' +
        'Create a dataset API key in the db-smart UI (dataset → API keys tab).',
    );
    process.exit(1);
  }

  const meta = await loadDatasetMeta(datasetId, pool);
  if (!meta) {
    console.error(`Dataset ${datasetId} not found.`);
    process.exit(1);
  }

  if (!meta.pkColumns.includes('inquiry_id')) {
    console.error(
      `Dataset ${datasetId} PK is [${meta.pkColumns.join(', ')}] but this script expects inquiry_id ` +
        `to be a PK column. Adjust the dataset PK in db-smart or update this script.`,
    );
    process.exit(1);
  }

  const table = quoteIdent(meta.tableName);

  const rows = await pool.query<OpenInquiry>(
    `SELECT inquiry_id, status, email, title, "timestamp", created_at, assigned_group, assigned_user
       FROM ${table}
      WHERE status = ANY($1::text[])
        AND deleted_at IS NULL
        AND inquiry_id IS NOT NULL
      ORDER BY created_at ASC NULLS LAST`,
    [OPEN_STATUSES as unknown as string[]],
  );

  if (!rows.rows.length) {
    console.log('No open inquiries to purge.');
    await pool.end();
    return;
  }

  const byStatus = new Map<string, number>();
  for (const row of rows.rows) {
    const s = row.status ?? '—';
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }

  const prefix = dryRun ? '[DRY RUN] ' : confirmed ? '' : '[PLAN] ';
  console.log(`${prefix}Would hard-DELETE ${rows.rows.length} open inquiry row(s):`);
  for (const [status, count] of byStatus) {
    console.log(`  • ${status}: ${count}`);
  }
  console.log('');
  for (const row of rows.rows) {
    console.log(
      `  - ${row.inquiry_id}  ${row.status}  ${row.email ?? '—'}  "${row.title ?? ''}"  ` +
        `assigned=${row.assigned_group ?? '—'}/${row.assigned_user ?? '—'}  ` +
        `created=${row.created_at ?? row.timestamp ?? '—'}`,
    );
  }

  if (!confirmed) {
    console.log('');
    if (dryRun) {
      console.log('[DRY RUN] Nothing was changed. Re-run with --yes to execute.');
    } else {
      console.log('Nothing was changed. Re-run with --yes to execute (or --dry-run for a preview).');
    }
    await pool.end();
    return;
  }

  const ids = rows.rows.map((r) => r.inquiry_id);

  console.log('');
  console.log(`Deleting ${ids.length} inquiry row(s) via db-smart API (Sheet + DB)…`);
  const outcomes = await deleteRowsViaApi(dbSmartUrl, dbSmartApiKey, datasetId, ids);

  const succeededIds = outcomes.filter((o) => o.ok).map((o) => o.inquiryId);
  const failed = outcomes.filter((o) => !o.ok);
  const sheetHits = outcomes.filter((o) => o.ok && o.sheetDeleted).length;
  const dbOnly = outcomes.filter((o) => o.ok && !o.sheetDeleted).length;

  console.log('');
  console.log(`Dataset rows: ${succeededIds.length} deleted (${sheetHits} also from Sheet, ${dbOnly} DB-only), ${failed.length} failed.`);

  if (failed.length > 0) {
    console.log('');
    console.log('Failed rows (leaving cascade rows in place so a re-run can retry):');
    for (const f of failed) {
      console.log(`  ✗ ${f.inquiryId} — ${f.error ?? 'unknown error'}`);
    }
  }

  if (succeededIds.length === 0) {
    console.log('');
    console.log('No successful deletes — skipping cascade cleanup. Fix the errors above and re-run.');
    await pool.end();
    process.exit(failed.length > 0 ? 1 : 0);
  }

  const client = await pool.connect();
  let deletedMessages = 0;
  let deletedHistory = 0;
  let deletedNotifications = 0;
  try {
    await client.query('BEGIN');
    const msgRes = await client.query(
      `DELETE FROM complaints_messages WHERE inquiry_id = ANY($1::uuid[])`,
      [succeededIds],
    );
    deletedMessages = msgRes.rowCount ?? 0;

    const histRes = await client.query(
      `DELETE FROM complaints_history WHERE inquiry_id = ANY($1::uuid[])`,
      [succeededIds],
    );
    deletedHistory = histRes.rowCount ?? 0;

    const notifRes = await client.query(
      `DELETE FROM complaints_notifications WHERE inquiry_id = ANY($1::uuid[])`,
      [succeededIds],
    );
    deletedNotifications = notifRes.rowCount ?? 0;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const after = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM ${table} WHERE status = ANY($1::text[]) AND deleted_at IS NULL`,
    [OPEN_STATUSES as unknown as string[]],
  );

  console.log('');
  console.log(`Done. Hard-DELETEd:`);
  console.log(`  • inquiries:     ${succeededIds.length} (${sheetHits} from Sheet, ${dbOnly} DB-only)`);
  console.log(`  • messages:      ${deletedMessages}`);
  console.log(`  • history:       ${deletedHistory}`);
  console.log(`  • notifications: ${deletedNotifications}`);
  console.log(`Open inquiries remaining: ${after.rows[0]?.cnt ?? '?'}`);

  if (dbOnly > 0) {
    console.log('');
    console.log(
      `Note: ${dbOnly} row(s) were deleted from the DB but not found in the Sheet by PK. ` +
        `If a matching row is still in the Sheet it will be re-imported on the next sync.`,
    );
  }

  await pool.end();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Purge failed:', err);
  process.exit(1);
});
