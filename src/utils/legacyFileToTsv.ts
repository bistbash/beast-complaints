import * as XLSX from 'xlsx';

const EXCEL_EXT = /\.(xlsx|xlsm|xls|xlsb)$/i;

export function isLegacyExcelFile(name: string): boolean {
  return EXCEL_EXT.test(name);
}

function cellToTsvField(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return '';
  const s = String(value);
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

/**
 * Read legacy export as TSV (tab-separated). Accepts .xlsx/.xls or plain TSV/txt.
 */
export async function legacyFileToTsv(file: File): Promise<string> {
  if (!isLegacyExcelFile(file.name)) {
    const text = await file.text();
    if (!text.trim()) throw new Error('הקובץ ריק');
    return text.replace(/^\uFEFF/, '');
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('הקובץ אינו מכיל גיליונות');

  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];

  const lines = rows
    .filter((row) => row.some((c) => String(c ?? '').trim() !== ''))
    .map((row) => row.map(cellToTsvField).join('\t'));

  if (lines.length < 2) {
    throw new Error('הגיליון חייב לכלול שורת כותרות ולפחות שורת נתונים אחת');
  }

  return lines.join('\n');
}
