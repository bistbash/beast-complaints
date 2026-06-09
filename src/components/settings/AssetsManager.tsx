import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '../ui/Button.tsx';
import api from '../../utils/api.ts';
import type { EmailSettings } from '../../hooks/useEmailSettings.ts';
import type { Notify } from '../../hooks/useToast.ts';

interface Props {
  settings: EmailSettings;
  notify: Notify;
}

/** Optional shortcuts — any valid English key works. */
const QUICK_KEYS = [
  { key: 'logo', label: 'לוגו' },
  { key: 'signature', label: 'חתימה' },
  { key: 'banner', label: 'באנר' },
  { key: 'footer_icon', label: 'אייקון תחתית' },
  { key: 'header_bg', label: 'רקע כותרת' },
] as const;

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

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

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

export default function AssetsManager({ settings, notify }: Props) {
  const { assets, uploadAsset, deleteAsset } = settings;
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploadKey, setUploadKey] = useState('');
  const [uploadLabel, setUploadLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [replaceKey, setReplaceKey] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const thumbUrlsRef = useRef<string[]>([]);

  const revokeThumbs = useCallback(() => {
    thumbUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    thumbUrlsRef.current = [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    revokeThumbs();

    void (async () => {
      const urls: Record<string, string> = {};
      for (const a of assets) {
        try {
          const cacheBust = encodeURIComponent(a.updatedAt);
          const res = await api.get(
            `/api/settings/email/assets/${a.assetKey}/file?v=${cacheBust}`,
            { responseType: 'blob' },
          );
          if (cancelled || res.status >= 400 || !(res.data instanceof Blob)) continue;
          const url = URL.createObjectURL(res.data);
          urls[a.assetKey] = url;
          thumbUrlsRef.current.push(url);
        } catch {
          /* skip thumbnail */
        }
      }
      if (!cancelled) setThumbs(urls);
    })();

    return () => {
      cancelled = true;
      revokeThumbs();
    };
  }, [assets, revokeThumbs]);

  const uploadBlob = async (key: string, label: string, file: File) => {
    const normalized = normalizeKey(key);
    if (!KEY_PATTERN.test(normalized)) {
      notify('err', 'מפתח באנגלית בלבד — אות, אחר כך אותיות/מספרים/קו תחתון (למשל my_icon)');
      return false;
    }
    setBusy(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await uploadAsset({
        key: normalized,
        label: label.trim() || normalized,
        contentType: file.type,
        dataBase64,
      });
      if (res.ok) {
        notify('ok', normalized === key ? 'הנכס נשמר' : `הנכס נשמר כ־${normalized}`);
        return true;
      }
      notify('err', res.error || 'העלאה נכשלה');
      return false;
    } catch {
      notify('err', 'קריאת הקובץ נכשלה');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const uploadNew = async (file: File) => {
    const key = uploadKey.trim();
    if (!key) {
      notify('err', 'הזינו מפתח לנכס (אנגלית)');
      return;
    }
    const ok = await uploadBlob(key, uploadLabel, file);
    if (ok && fileRef.current) fileRef.current.value = '';
  };

  const uploadReplace = async (file: File) => {
    const asset = assets.find((a) => a.assetKey === replaceKey);
    if (!asset) return;
    const ok = await uploadBlob(asset.assetKey, asset.label, file);
    if (ok && replaceRef.current) replaceRef.current.value = '';
    setReplaceKey(null);
  };

  const remove = async (assetKey: string) => {
    if (!confirm(`למחוק את הנכס "${assetKey}"?`)) return;
    setBusy(true);
    setThumbs((prev) => {
      const next = { ...prev };
      if (next[assetKey]) {
        URL.revokeObjectURL(next[assetKey]);
        delete next[assetKey];
      }
      return next;
    });
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

  const applyQuickKey = (key: string, label: string) => {
    setUploadKey(key);
    if (!uploadLabel.trim() || QUICK_KEYS.some((q) => q.key === uploadKey)) {
      setUploadLabel(label);
    }
  };

  return (
    <div className="surface-card p-5 md:p-6">
      <h2 className="text-lg font-bold tracking-tight">נכסים גרפיים</h2>
      <p className="muted mt-1 text-sm">
        כל תמונה מקבלת מפתח באנגלית (למשל <code className="font-mono text-xs">logo</code>,{' '}
        <code className="font-mono text-xs">stamp</code>) ומשתנה במכתב:{' '}
        <code className="rounded bg-neutral-100 px-1 font-mono text-xs dark:bg-neutral-800" dir="ltr">
          {'{{asset_<מפתח>}}'}
        </code>
        . אין הגבלה ללוגו/חתימה בלבד.
      </p>

      {assets.length > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((a) => {
            const variable = `{{asset_${a.assetKey}}}`;
            return (
              <div key={`${a.assetKey}-${a.updatedAt}`} className="overflow-hidden rounded-xl border border-subtle bg-surface">
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
                  <code className="mt-0.5 block truncate font-mono text-[10px] text-neutral-500" dir="ltr">
                    {a.assetKey}
                  </code>
                  <div className="mt-0.5 text-[11px] text-neutral-400">{formatBytes(a.byteSize)}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      className="flex-1 truncate rounded-md bg-neutral-100 px-2 py-0.5 text-start font-mono text-[10px] text-indigo-600 transition hover:bg-indigo-50 dark:bg-neutral-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                      dir="ltr"
                      title="העתקת המשתנה"
                      onClick={() => void copyVar(variable)}
                    >
                      {copied === variable ? '✓ הועתק' : variable}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium text-neutral-600 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      disabled={busy}
                      onClick={() => {
                        setReplaceKey(a.assetKey);
                        replaceRef.current?.click();
                      }}
                    >
                      החלף
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-0.5 text-[10px] text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-950/30"
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
          עדיין לא הועלו נכסים — הוסיפו תמונה למטה
        </p>
      )}

      <div className="mt-5 rounded-xl border border-subtle bg-surface-sunken p-4">
        <h3 className="text-sm font-semibold">הוספת / החלפת נכס</h3>
        <p className="mt-1 text-xs text-neutral-500">
          מפתח חדש יוצר נכס; מפתח קיים מחליף את הקובץ (מחיקה לפני העלאה מחדש לא נדרשת).
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs sm:col-span-1">
            <span className="mb-1 block font-medium text-neutral-600">מפתח (אנגלית, חובה)</span>
            <input
              type="text"
              className="input !py-2 font-mono text-sm"
              dir="ltr"
              value={uploadKey}
              onChange={(e) => setUploadKey(e.target.value)}
              placeholder="e.g. logo, stamp, hero_image"
            />
          </label>
          <label className="block text-xs sm:col-span-1">
            <span className="mb-1 block font-medium text-neutral-600">שם תצוגה</span>
            <input
              type="text"
              className="input !py-2 text-sm"
              value={uploadLabel}
              onChange={(e) => setUploadLabel(e.target.value)}
              placeholder="למשל לוגו רשמי"
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-neutral-400">דוגמאות מהירות:</span>
          {QUICK_KEYS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="rounded-lg border border-subtle bg-surface px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:hover:text-indigo-300"
              onClick={() => applyQuickKey(p.key, p.label)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadNew(f);
            }}
          />
          <input
            ref={replaceRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadReplace(f);
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || !uploadKey.trim()}
            loading={busy && !replaceKey}
            onClick={() => fileRef.current?.click()}
          >
            בחירת תמונה
          </Button>
          {uploadKey.trim() && (
            <code className="text-xs text-neutral-500" dir="ltr">
              → {'{{asset_' + normalizeKey(uploadKey) + '}}'}
            </code>
          )}
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">PNG · JPG · GIF · WEBP — עד 512KB</p>
      </div>
    </div>
  );
}
