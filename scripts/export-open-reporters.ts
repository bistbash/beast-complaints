/**
 * Export all reporters (submitters) who currently have an OPEN inquiry
 * (status IN 'new', 'routed', 'awaiting_manager') to an .xlsx file for
 * sending them SMS.
 *
 * The workbook contains two sheets:
 *  - "מדווחים ייחודיים" — one row per unique phone number (or email fallback),
 *    with the count of open inquiries and a concatenation of their titles.
 *  - "כל הפניות הפתוחות"  — one row per open inquiry.
 *
 * Usage:
 *   npm run export-open-reporters                # writes exports/open-reporters-<timestamp>.xlsx
 *   npm run export-open-reporters -- out.xlsx    # writes to the given path
 */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import XLSX from 'xlsx';
import { pool } from '../config/db.ts';
import { loadDatasetMeta } from '../services/datasetMeta.ts';
import { quoteIdent } from '../lib/quoteIdent.ts';

const OPEN_STATUSES = ['new', 'routed', 'awaiting_manager'] as const;

const STATUS_LABEL: Record<string, string> = {
  new: 'חדשה',
  routed: 'נותבה',
  awaiting_manager: 'ממתינה למנהל',
};

function tsSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function normalizePhone(raw: string | null | undefined): string {
  if (raw == null) return '';
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  // Local Israeli mobile: add leading 0 if missing (e.g. 502223344 -> 0502223344)
  if (digits.length === 9 && digits.startsWith('5')) return `0${digits}`;
  return digits;
}

async function main() {
  const outPathArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const outPath = resolve(process.cwd(), outPathArg ?? `exports/open-reporters-${tsSuffix()}.xlsx`);

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
  const rows = await pool.query<{
    inquiry_id: string;
    status: string | null;
    priority: string | null;
    full_name: string | null;
    email: string | null;
    phone_number: string | null;
    requester_type: string | null;
    title: string | null;
    request_category: string | null;
    grade_level: string | null;
    class_name: number | null;
    department: string | null;
    entity: string | null;
    role: string | null;
    role_bislat: string | null;
    assigned_group: string | null;
    assigned_user: string | null;
    created_at: Date | null;
    due_at: Date | null;
    timestamp: string | null;
  }>(
    `SELECT inquiry_id, status, priority,
            full_name, email, phone_number::text AS phone_number, requester_type,
            title, request_category, grade_level, class_name, department, entity, role, role_bislat,
            assigned_group, assigned_user, created_at, due_at, "timestamp"
       FROM ${table}
      WHERE status = ANY($1::text[])
        AND deleted_at IS NULL
        AND inquiry_id IS NOT NULL
      ORDER BY created_at ASC NULLS LAST`,
    [OPEN_STATUSES as unknown as string[]],
  );

  if (!rows.rows.length) {
    console.log('No open inquiries — nothing to export.');
    await pool.end();
    return;
  }

  const inquirySheet = rows.rows.map((r) => ({
    'מזהה פנייה': r.inquiry_id,
    'שם מלא': r.full_name ?? '',
    'טלפון': normalizePhone(r.phone_number),
    'מייל': r.email ?? '',
    'סטטוס': STATUS_LABEL[r.status ?? ''] ?? r.status ?? '',
    'דחיפות': r.priority ?? '',
    'סוג פונה': r.requester_type ?? '',
    'נושא': r.title ?? '',
    'קטגוריה': r.request_category ?? '',
    'שכבה': r.grade_level ?? '',
    'כיתה': r.class_name ?? '',
    'מחלקה': r.department ?? '',
    'גורם': r.entity ?? '',
    'תפקיד': r.role ?? '',
    'תפקיד בבסל"ת': r.role_bislat ?? '',
    'קבוצה מטפלת': r.assigned_group ?? '',
    'חבר צוות מטפל': r.assigned_user ?? '',
    'נפתחה בתאריך': r.created_at ? new Date(r.created_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : (r.timestamp ?? ''),
    'תאריך יעד (SLA)': r.due_at ? new Date(r.due_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '',
  }));

  const byReporter = new Map<
    string,
    {
      key: string;
      name: string;
      phone: string;
      email: string;
      requester_type: string;
      inquiries: { title: string; created_at: Date | null; status: string | null; priority: string | null }[];
    }
  >();
  for (const r of rows.rows) {
    const phone = normalizePhone(r.phone_number);
    const email = (r.email ?? '').trim().toLowerCase();
    const key = phone || email || `row-${r.inquiry_id}`;
    let entry = byReporter.get(key);
    if (!entry) {
      entry = {
        key,
        name: r.full_name ?? '',
        phone,
        email: r.email ?? '',
        requester_type: r.requester_type ?? '',
        inquiries: [],
      };
      byReporter.set(key, entry);
    }
    if (!entry.name && r.full_name) entry.name = r.full_name;
    if (!entry.phone && phone) entry.phone = phone;
    if (!entry.email && r.email) entry.email = r.email;
    if (!entry.requester_type && r.requester_type) entry.requester_type = r.requester_type;
    entry.inquiries.push({
      title: r.title ?? '',
      created_at: r.created_at,
      status: r.status,
      priority: r.priority,
    });
  }

  const reporterSheet = Array.from(byReporter.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))
    .map((e) => ({
      'שם מלא': e.name,
      'טלפון': e.phone,
      'מייל': e.email,
      'סוג פונה': e.requester_type,
      'מספר פניות פתוחות': e.inquiries.length,
      'נושאי הפניות': e.inquiries
        .map((i) => `• ${i.title || '(ללא נושא)'} [${STATUS_LABEL[i.status ?? ''] ?? i.status ?? ''}]`)
        .join('\n'),
      'פנייה אחרונה נפתחה': (() => {
        const dates = e.inquiries.map((i) => i.created_at).filter((d): d is Date => d != null);
        if (!dates.length) return '';
        const latest = new Date(Math.max(...dates.map((d) => new Date(d).getTime())));
        return latest.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
      })(),
    }));

  const wb = XLSX.utils.book_new();
  const wsReporters = XLSX.utils.json_to_sheet(reporterSheet);
  const wsInquiries = XLSX.utils.json_to_sheet(inquirySheet);
  wsReporters['!cols'] = [
    { wch: 22 },
    { wch: 14 },
    { wch: 28 },
    { wch: 14 },
    { wch: 8 },
    { wch: 60 },
    { wch: 20 },
  ];
  wsInquiries['!cols'] = [
    { wch: 38 },
    { wch: 22 },
    { wch: 14 },
    { wch: 28 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 40 },
    { wch: 18 },
    { wch: 8 },
    { wch: 6 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 22 },
    { wch: 20 },
    { wch: 20 },
  ];
  wsReporters['!views'] = [{ RTL: true }];
  wsInquiries['!views'] = [{ RTL: true }];
  XLSX.utils.book_append_sheet(wb, wsReporters, 'מדווחים ייחודיים');
  XLSX.utils.book_append_sheet(wb, wsInquiries, 'כל הפניות הפתוחות');

  await fs.mkdir(dirname(outPath), { recursive: true });
  XLSX.writeFile(wb, outPath);

  console.log(`Wrote ${reporterSheet.length} unique reporter(s) / ${inquirySheet.length} open inquir(y|ies) to:`);
  console.log(`  ${outPath}`);
  await pool.end();
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
