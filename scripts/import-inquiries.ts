/**
 * Import inquiries from a TSV/CSV file into the db-smart dataset table.
 *
 * Use this when the Google Sheets → db-smart sync has drifted (missing rows,
 * scrambled IDs, etc.) and you have an authoritative export from the sheet
 * that you want to push to the database directly.
 *
 * Behavior:
 *   - Matches existing rows by (timestamp, email). When found, ONLY the
 *     sheet-managed columns are updated. Workflow state (status, assigned_user,
 *     team_response, …) is preserved exactly as it is.
 *   - When no match, INSERTs a new row and lets the workflow column DEFAULTs
 *     populate status='new', priority='medium', a fresh inquiry_id, etc.
 *   - Existing rows are NEVER deleted. If the source file is missing a row that
 *     exists in the DB, the DB row stays untouched.
 *
 * Usage:
 *   npm run import-inquiries -- data/inquiries.tsv
 *   npm run import-inquiries -- data/inquiries.tsv --dry-run
 *
 * Input format: tab-separated (TSV). First line is the header row. Hebrew
 * headers map to dataset columns by matching against `dataset_columns.original_header`.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../config/db.ts';
import { loadDatasetMeta } from '../services/datasetMeta.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';
import { ensureInquiryWorkflowColumns } from '../lib/schema.ts';

const DATASET_ID = process.env.COMPLAINTS_DATASET_ID;
const SHEET_COLUMNS = [
  'timestamp',
  'email',
  'requester_type',
  'full_name',
  'phone_number',
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

function parseArgs(): { file: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: tsx scripts/import-inquiries.ts <file.tsv> [--dry-run]');
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
 * Map a Hebrew header line to the underlying pg column names by looking up
 * each header in dataset_columns. If a header isn't in the dataset we leave
 * that column unmapped and skip it during INSERT/UPDATE.
 */
async function buildHeaderMap(
  datasetId: string,
  headers: string[],
): Promise<Array<{ header: string; pgColumn: string | null }>> {
  const res = await pool.query<{ original_header: string; pg_column_name: string }>(
    `SELECT original_header, pg_column_name FROM dataset_columns WHERE dataset_id = $1`,
    [datasetId],
  );
  const byHeader = new Map<string, string>();
  for (const row of res.rows) {
    byHeader.set(normalizeHeader(row.original_header), row.pg_column_name);
  }
  return headers.map((h) => ({
    header: h,
    pgColumn: byHeader.get(normalizeHeader(h)) ?? null,
  }));
}

function normalizeHeader(s: string): string {
  // Hebrew strings sometimes carry leading BOM/whitespace; quotes vary between
  // “smart” and ASCII variants. Strip everything non-significant.
  return s
    .replace(/\uFEFF/g, '')
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isEmpty(value: string | undefined | null): boolean {
  if (value == null) return true;
  return String(value).trim() === '';
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
  const [headerRow, ...dataRows] = rows;

  const meta = await loadDatasetMeta(DATASET_ID);
  if (!meta) {
    console.error(`Dataset ${DATASET_ID} not found.`);
    process.exit(1);
  }
  await ensureInquiryWorkflowColumns(pool, meta.tableName);

  const mapping = await buildHeaderMap(DATASET_ID, headerRow);
  console.log(`\nHeader mapping (file → pg column):`);
  for (const m of mapping) {
    const ok = m.pgColumn ? '✓' : '✗ (skipped)';
    console.log(`  ${ok}  "${m.header}"  →  ${m.pgColumn ?? '—'}`);
  }
  console.log();

  const usedColumns = mapping.filter((m) => m.pgColumn);
  if (!usedColumns.some((m) => m.pgColumn === 'timestamp' || m.pgColumn === 'email')) {
    console.error('Cannot run import: TSV must include both timestamp and email columns.');
    process.exit(1);
  }

  const table = quoteIdent(meta.tableName);
  const existing = await pool.query<{ inquiry_id: string; timestamp: string; email: string }>(
    `SELECT inquiry_id, "timestamp", email FROM ${table}`,
  );
  const existingMap = new Map<string, string>();
  for (const r of existing.rows) {
    existingMap.set(keyFor(r.timestamp, r.email), r.inquiry_id);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const data of dataRows) {
    const record: Record<string, string> = {};
    for (let i = 0; i < mapping.length; i++) {
      const col = mapping[i].pgColumn;
      if (!col) continue;
      record[col] = (data[i] ?? '').trim();
    }
    if (isEmpty(record.timestamp) || isEmpty(record.email)) {
      console.warn(
        `  ⚠ row skipped (missing timestamp or email): ts="${record.timestamp ?? ''}" email="${record.email ?? ''}"`,
      );
      skipped++;
      continue;
    }
    const key = keyFor(record.timestamp, record.email);
    const existingId = existingMap.get(key);

    if (existingId) {
      // Update only sheet columns — preserve workflow state.
      const setCols = SHEET_COLUMNS.filter((c) => c in record && c !== 'timestamp' && c !== 'email');
      // Quick "did anything change" check to avoid no-op writes.
      const currentRes = await pool.query<Record<string, string | null>>(
        `SELECT ${setCols.map((c) => quoteIdent(c)).join(', ')} FROM ${table} WHERE inquiry_id = $1`,
        [existingId],
      );
      const current = currentRes.rows[0] ?? {};
      const changed = setCols.filter(
        (c) => (current[c] ?? '') !== (record[c] ?? ''),
      );
      if (changed.length === 0) {
        unchanged++;
        continue;
      }
      const sets = changed.map((c, idx) => `${quoteIdent(c)} = $${idx + 1}`);
      const values = changed.map((c) => record[c]);
      values.push(existingId);
      if (!dryRun) {
        await pool.query(
          `UPDATE ${table} SET ${sets.join(', ')} WHERE inquiry_id = $${values.length}`,
          values,
        );
      }
      console.log(
        `  ↻ updated ${existingId} (${changed.length} field${changed.length === 1 ? '' : 's'}: ${changed.join(', ')})`,
      );
      updated++;
    } else {
      const cols = SHEET_COLUMNS.filter((c) => c in record && !isEmpty(record[c]));
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const values = cols.map((c) => record[c]);
      if (!dryRun) {
        await pool.query(
          `INSERT INTO ${table} (${cols.map((c) => quoteIdent(c)).join(', ')})
           VALUES (${placeholders.join(', ')})`,
          values,
        );
      }
      console.log(`  + inserted (ts=${record.timestamp}, email=${record.email})`);
      inserted++;
    }
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Done.`);
  console.log(`  inserted:  ${inserted}`);
  console.log(`  updated:   ${updated}`);
  console.log(`  unchanged: ${unchanged}`);
  console.log(`  skipped:   ${skipped}`);
  await pool.end();
}

function keyFor(timestamp: string, email: string): string {
  return `${(timestamp || '').trim()}||${(email || '').trim().toLowerCase()}`;
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
