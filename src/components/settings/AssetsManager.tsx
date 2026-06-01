import { useEffect, useRef, useState } from 'react';
import Button from '../ui/Button.tsx';
import api from '../../utils/api.ts';
import type { EmailSettings } from '../../hooks/useEmailSettings.ts';
import type { Notify } from '../../hooks/useToast.ts';

interface Props {
  settings: EmailSettings;
  notify: Notify;
}

const PRESETS = [
  { key: 'logo', label: 'לוגו' },
  { key: 'signature', label: 'חתימה' },
  { key: 'banner', label: 'באנר' },
] as const;

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function AssetsManager({ settings, notify }: Props) {
  const { assets, uploadAsset, deleteAsset } = settings;
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploadKey, setUploadKey] = useState('logo');
  const [uploadLabel, setUploadLabel] = useState('לוגו');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const urls: Record<string, string> = {};
      for (const a of assets) {
        try {
          const res = await api.get(`/api/settings/email/assets/${a.assetKey}/file`, {
            responseType: 'blob',
          });
          if (cancelled || res.status >= 400 || !(res.data instanceof Blob)) continue;
          const url = URL.createObjectURL(res.data);
          urls[a.assetKey] = url;
          created.push(url);
        } catch {
          /* skip thumbnail */
        }
      }
      if (!cancelled) setThumbs(urls);
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [assets]);

  const pickPreset = (key: string, label: string) => {
    setUploadKey(key);
    setUploadLabel(label);
  };

  const upload = async (file: File) => {
    const key = uploadKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      notify('err', 'מפתח באנגלית בלבד (למשל logo)');
      return;
    }
    setBusy(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await uploadAsset({
        key,
        label: uploadLabel.trim() || key,
        contentType: file.type,
        dataBase64,
      });
      notify(res.ok ? 'ok' : 'err', res.ok ? 'הנכס נשמר' : res.error || 'העלאה נכשלה');
    } catch {
      notify('err', 'קריאת הקובץ נכשלה');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (assetKey: string) => {
    if (!confirm('למחוק את הנכס?')) return;
    setBusy(true);
    const res = await deleteAsset(assetKey);
    setBusy(false);
    notify(res.ok ? 'ok' : 'err', res.ok ? 'הנכס נמחק' : res.error || 'מחיקה נכשלה');
  };

  const copyVar = async (variable: string) => {
    try {
      await navigator.clipboard.writeText(variable);
      setCopied(variable);
      setTimeout(() => setCopied((c) => (c === variable ? null : c)), 1500);
    } catch {
      notify('err', 'ההעתקה נכשלה');
    }
  };

  return (
    <div className="surface-card p-5 md:p-6">
      <h2 className="text-lg font-bold tracking-tight">נכסים גרפיים</h2>
      <p className="muted mt-1 text-sm">
        לוגו, חתימה ובאנרים שמשובצים במכתבי הסגירה. כל נכס זמין בעורך כמשתנה{' '}
        <code className="rounded bg-neutral-100 px-1 font-mono text-xs dark:bg-neutral-800" dir="ltr">
          {'{{asset_logo}}'}
        </code>
        .
      </p>

      {assets.length > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((a) => {
            const variable = `{{asset_${a.assetKey}}}`;
            return (
              <div key={a.assetKey} className="overflow-hidden rounded-xl border border-subtle bg-surface">
                <div className="flex h-28 items-center justify-center bg-neutral-50 p-3 dark:bg-neutral-900">
                  {thumbs[a.assetKey] ? (
                    <img
                      src={thumbs[a.assetKey]}
                      alt={a.label}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-neutral-400">טוען…</span>
                  )}
                </div>
                <div className="border-t border-subtle p-2.5">
                  <div className="truncate text-sm font-medium">{a.label}</div>
                  <div className="mt-0.5 text-[11px] text-neutral-400">{formatBytes(a.byteSize)}</div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      className="flex-1 truncate rounded-md bg-neutral-100 px-2 py-1 text-start font-mono text-[10px] text-indigo-600 transition hover:bg-indigo-50 dark:bg-neutral-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                      dir="ltr"
                      title="העתקת המשתנה"
                      onClick={() => void copyVar(variable)}
                    >
                      {copied === variable ? '✓ הועתק' : variable}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      disabled={busy}
                      onClick={() => void remove(a.assetKey)}
                    >
                      מחק
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-subtle bg-surface-sunken px-4 py-6 text-center text-sm text-neutral-500">
          עדיין לא הועלו נכסים
        </p>
      )}

      <div className="mt-5 rounded-xl border border-subtle bg-surface-sunken p-4">
        <h3 className="text-sm font-semibold">העלאת נכס</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  uploadKey === p.key
                    ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800'
                }`}
                onClick={() => pickPreset(p.key, p.label)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="min-w-[110px] flex-1 text-xs">
            <span className="mb-1 block text-neutral-500">מפתח (אנגלית)</span>
            <input
              type="text"
              className="input !py-1.5 font-mono text-xs"
              dir="ltr"
              value={uploadKey}
              onChange={(e) => setUploadKey(e.target.value)}
            />
          </label>
          <label className="min-w-[110px] flex-1 text-xs">
            <span className="mb-1 block text-neutral-500">שם תצוגה</span>
            <input
              type="text"
              className="input !py-1.5 text-xs"
              value={uploadLabel}
              onChange={(e) => setUploadLabel(e.target.value)}
            />
          </label>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy}
              loading={busy}
              onClick={() => fileRef.current?.click()}
            >
              בחירת תמונה
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">PNG · JPG · GIF · WEBP — מומלץ עד 200KB</p>
      </div>
    </div>
  );
}
