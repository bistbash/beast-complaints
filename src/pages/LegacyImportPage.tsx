import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/api.ts';
import useCapabilities from '../hooks/useCapabilities.ts';
import Card from '../components/ui/Card.tsx';
import { legacyFileToTsv } from '../utils/legacyFileToTsv.ts';

interface ImportResult {
  dryRun: boolean;
  rowCount: number;
  stats: {
    matched: number;
    inserted: number;
    workflowUpdated: number;
    messagesInserted: number;
    alreadyImported: number;
    unmatched: number;
  };
  warnings: string[];
}

export default function LegacyImportPage() {
  const { capabilities } = useCapabilities();
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  if (capabilities && !capabilities.isAdmin) {
    return <Navigate to="/inbox" replace />;
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setResult(null);
    setContent('');
    setParsing(true);
    try {
      const tsv = await legacyFileToTsv(file);
      setContent(tsv);
    } catch (err) {
      setContent('');
      setError(err instanceof Error ? err.message : 'לא ניתן לקרוא את הקובץ');
    } finally {
      setParsing(false);
    }
  }

  async function runImport() {
    if (!content.trim()) {
      setError('בחר קובץ Excel או TSV לפני ההרצה');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<ImportResult>(
        '/api/admin/legacy-import',
        { content, dryRun },
        { timeout: 120_000 },
      );
      if (res.status >= 400) {
        setError((res.data as { error?: string })?.error || 'הייבוא נכשל');
        return;
      }
      setResult(res.data);
    } catch {
      setError('שגיאת רשת או פסק זמן — נסה שוב');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-max py-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">ייבוא ממערכת ישנה (זמני)</h1>
        <p className="muted mt-1 max-w-2xl text-sm">
          העלאת ייצוא Excel או TSV מ־complaints-manager לעדכון סטטוס, תגובות צוות/מנהל, הודעות וסגירות.
          מומלץ להריץ קודם ב־<strong>בדיקה יבשה</strong> ואז בייבוא אמיתי.
        </p>
      </header>

      <Card className="max-w-2xl space-y-4">
        <ol className="list-decimal space-y-1 pr-5 text-sm text-neutral-600 dark:text-neutral-300">
          <li>העלה את קובץ ה־<strong>Excel (.xlsx)</strong> כפי שייצאת ממערכת הפניות הישנה (או TSV אם כבר המרת).</li>
          <li>בחר את הקובץ למטה — המערכת קוראת את הגיליון הראשון וממירה אוטומטית.</li>
          <li>אם הסטטיסטיקה נראית נכונה — בטל סימון &quot;בדיקה יבשה&quot; והרץ שוב.</li>
        </ol>

        <div>
          <label className="mb-1 block text-sm font-medium">קובץ ייצוא (Excel / TSV)</label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.xlsb,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/tab-separated-values,text/plain"
            onChange={onFileChange}
            className="block w-full text-sm"
          />
          {fileName && (
            <p className="mt-1 text-xs text-neutral-500">
              נבחר: {fileName}
              {parsing && ' — קורא קובץ…'}
              {!parsing && content && ` — ${content.split('\n').length - 1} שורות נתונים`}
            </p>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="rounded border-neutral-300"
          />
          בדיקה יבשה (ללא שינוי בבסיס הנתונים)
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || parsing || !content}
            onClick={runImport}
          >
            {loading ? 'מריץ…' : dryRun ? 'הרץ בדיקה' : 'הרץ ייבוא'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setContent('');
              setFileName(null);
              setResult(null);
              setError(null);
              if (fileRef.current) fileRef.current.value = '';
            }}
          >
            נקה
          </button>
        </div>

        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

        {result && (
          <div className="rounded-lg border border-subtle bg-neutral-50 p-4 text-sm dark:bg-neutral-900/50">
            <p className="font-semibold">
              {result.dryRun ? 'תוצאות בדיקה יבשה' : 'ייבוא הושלם'} — {result.rowCount} שורות
            </p>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
              כל שורה שנספרת ב&quot;עודכנו workflow&quot; טופלה בפועל. &quot;כבר יובא בעבר&quot; מציין רק כמה שורות כבר
              סומנו עם `legacy_id` מהיסטוריית ייבוא קודמת.
            </p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              <li>התאמות לרשומות קיימות: {result.stats.matched}</li>
              <li>הוספות חדשות: {result.stats.inserted}</li>
              <li>עודכנו workflow: {result.stats.workflowUpdated}</li>
              <li>הודעות חדשות: {result.stats.messagesInserted}</li>
              <li>כבר סומנו עם legacy_id: {result.stats.alreadyImported}</li>
              <li>לא עובדו: {result.stats.unmatched}</li>
            </ul>
            {result.warnings.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-amber-700 dark:text-amber-300">
                  {result.warnings.length} אזהרות
                </summary>
                <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-neutral-600 dark:text-neutral-400">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
