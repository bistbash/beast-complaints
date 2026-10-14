/**
 * One-shot: permanently delete every OPEN inquiry (status IN
 * 'new', 'routed', 'awaiting_manager') by calling the db-smart DELETE row API,
 * which deletes the row from BOTH PostgreSQL AND the source Google Sheet — so
 * the next Sheet→DB sync can't resurrect it.
 *
 * The dataset PK is `timestamp` (the Google Form submission timestamp string).
 *
 * Authentication: uses a per-dataset API key (`dbs_…`) so we don't need a
 * live Beast SSO session. If one isn't stored in `.env` as `DB_SMART_API_KEY`,
 * this script provisions a temporary one directly in the `dataset_api_keys`
 * table (using the direct PostgreSQL connection that the app already uses),
 * calls the API with it, and then revokes it.
 *
 * Config (via env / .env):
 *   DB_SMART_URL        — base URL of the db-smart service (e.g. http://192.168.100.12:3003)
 *   DB_SMART_API_KEY    — optional pre-created key. If missing, a temporary one is minted+revoked.
 *   COMPLAINTS_DATASET_ID — the dataset UUID (already in beast-complaints .env)
 *
 * Usage:
 *   npm run purge-open-inquiries-via-dbsmart -- --dry-run
 *   npm run purge-open-inquiries-via-dbsmart -- --yes
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { pool } from '../config/db.ts';
import { loadDatasetMeta } from '../services/datasetMeta.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';

const OPEN_STATUSES = ['new', 'routed', 'awaiting_manager'] as const;

const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--yes');

const DATASET_API_KEY_PREFIX = 'dbs_';
function generateApiKey() {
  return DATASET_API_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}
function hashApiKey(raw: string) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}
function keyPrefixForDisplay(raw: string) {
  const s = String(raw);
  if (s.length <= 14) return `${s}…`;
  return `${s.slice(0, 14)}…`;
}

interface ProvisionedKey {
  raw: string;
  id: string;
  provisioned: boolean; // true → we created it here and should revoke it after
}

async function ensureApiKey(datasetId: string): Promise<ProvisionedKey> {
  const existing = process.env.DB_SMART_API_KEY?.trim();
  if (existing) {
    if (!existing.startsWith(DATASET_API_KEY_PREFIX)) {
      throw new Error(`DB_SMART_API_KEY must start with "${DATASET_API_KEY_PREFIX}"`);
    }
    return { raw: existing, id: '(external)', provisioned: false };
  }

  const dsRes = await pool.query<{ created_by: string }>(
    `SELECT created_by FROM datasets WHERE id = $1`,
    [datasetId],
  );
  if (dsRes.rows.length === 0) {
    throw new Error(`Dataset ${datasetId} not found`);
  }
  const createdBy = dsRes.rows[0].created_by || 'system';

  const raw = generateApiKey();
  const keyHash = hashApiKey(raw);
  const keyPrefix = keyPrefixForDisplay(raw);
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO dataset_api_keys (dataset_id, key_hash, key_prefix, label, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [datasetId, keyHash, keyPrefix, 'purge-open-inquiries (temporary)', createdBy],
  );
  return { raw, id: ins.rows[0].id, provisioned: true };
}

async function revokeApiKey(keyId: string) {
  await pool.query(`DELETE FROM dataset_api_keys WHERE id = $1`, [keyId]);
}

async function main() {
  const datasetId = process.env.COMPLAINTS_DATASET_ID;
  if (!datasetId) {
    console.error('COMPLAINTS_DATASET_ID is not set.');
    process.exit(1);
  }
  const dbSmartUrl = (process.env.DB_SMART_URL || '').replace(/\/+$/, '');
  if (!dbSmartUrl) {
    console.error(
      'DB_SMART_URL is not set. Add it to .env (e.g. DB_SMART_URL=http://192.168.100.12:3003).',
    );
    process.exit(1);
  }

  const meta = await loadDatasetMeta(datasetId, pool);
  if (!meta) {
    console.error(`Dataset ${datasetId} not found.`);
    process.exit(1);
  }
  if (!meta.pkColumns.length) {
    console.error('Dataset has no PK configured — cannot delete via db-smart.');
    process.exit(1);
  }

  const columnMetaByPg = new Map(meta.columns.map((c) => [c.pgColumnName, c]));
  const table = quoteIdent(meta.tableName);
  const pkSelect = meta.pkColumns.map((c) => quoteIdent(c)).join(', ');

  const rows = await pool.query<Record<string, unknown>>(
    `SELECT inquiry_id, status, email, title, ${pkSelect}
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

  const prefix = dryRun ? '[DRY RUN] ' : confirmed ? '' : '[PLAN] ';
  console.log(
    `${prefix}Would delete ${rows.rows.length} open inquir(y|ies) via db-smart (DB + Google Sheet)`,
  );
  for (const row of rows.rows) {
    const pkRepr = meta.pkColumns.map((pk) => `${pk}=${JSON.stringify(row[pk])}`).join(', ');
    console.log(
      `  - ${row.inquiry_id}  ${row.status ?? '—'}  ${row.email ?? '—'}  "${row.title ?? ''}"  [${pkRepr}]`,
    );
  }

  if (!confirmed) {
    console.log('');
    console.log('Nothing was changed. Re-run with --yes to execute (or --dry-run for a preview).');
    await pool.end();
    return;
  }

  const key = await ensureApiKey(datasetId);
  if (key.provisioned) {
    console.log(`\nProvisioned temporary db-smart API key ${key.id} (will be revoked after).`);
  } else {
    console.log('\nUsing DB_SMART_API_KEY from environment.');
  }

  let ok = 0;
  let sheetDeleted = 0;
  const failures: { pk: unknown; err: string; status?: number }[] = [];
  const endpoint = `${dbSmartUrl}/api/datasets/${datasetId}/rows`;

  try {
    for (const row of rows.rows) {
      const pk: Record<string, unknown> = {};
      for (const pkCol of meta.pkColumns) {
        const colMeta = columnMetaByPg.get(pkCol);
        pk[colMeta?.originalHeader || pkCol] = row[pkCol];
      }
      try {
        const resp = await fetch(endpoint, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key.raw}`,
          },
          body: JSON.stringify({ pk }),
        });
        const body = (await resp.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          deleted?: number;
          sheetDeleted?: boolean;
        };
        if (!resp.ok || body.success === false) {
          failures.push({ pk, err: body.error || `HTTP ${resp.status}`, status: resp.status });
          console.log(
            `  ✗ ${JSON.stringify(pk)}  →  ${resp.status}  ${body.error || 'failed'}`,
          );
        } else {
          ok += body.deleted ?? 0;
          if (body.sheetDeleted) sheetDeleted += 1;
          console.log(
            `  ✓ ${JSON.stringify(pk)}  →  deleted=${body.deleted ?? 0}  sheet=${body.sheetDeleted ? 'yes' : 'no'}`,
          );
        }
      } catch (err) {
        failures.push({ pk, err: err instanceof Error ? err.message : String(err) });
        console.log(`  ✗ ${JSON.stringify(pk)}  →  ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    if (key.provisioned) {
      try {
        await revokeApiKey(key.id);
        console.log(`\nRevoked temporary API key ${key.id}.`);
      } catch (err) {
        console.error(
          `Warning: failed to revoke temporary API key ${key.id}. Remove it manually from dataset_api_keys. Error:`,
          err,
        );
      }
    }
  }

  console.log('');
  console.log(`Done.`);
  console.log(`  • DB rows deleted:    ${ok}`);
  console.log(`  • Sheet rows deleted: ${sheetDeleted}`);
  console.log(`  • Failures:           ${failures.length}`);
  if (failures.length) {
    console.log('\nFailure details:');
    for (const f of failures) {
      console.log(`  - ${JSON.stringify(f.pk)}  status=${f.status ?? '—'}  ${f.err}`);
    }
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('Purge (via db-smart) failed:', err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
