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

  const previewVar = uploadKey.trim() ? `{{asset_${normalizeKey(uploadKey)}}}` : null;

  return (
    <div className="assets-layout">
      <div className="settings-block">
        <div className="settings-block-head">
          <div className="settings-block-title">נכסים קיימים ({assets.length})</div>
          <div className="settings-block-desc">לחיצה על המשתנה מעתיקה אותו ללוח — הדביקו בתבנית HTML</div>
        </div>
        <div className="settings-block-body">
          {assets.length > 0 ? (
            <div className="asset-list">
              {assets.map((a) => {
                const variable = `{{asset_${a.assetKey}}}`;
                return (
                  <div key={`${a.assetKey}-${a.updatedAt}`} className="asset-row">
                    <div className="asset-row-thumb">
                      {thumbs[a.assetKey] ? (
                        <img
                          src={thumbs[a.assetKey]}
                          alt={a.label}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] text-neutral-400">…</span>
                      )}
                    </div>

                    <div className="asset-row-meta">
                      <div className="asset-row-label">{a.label}</div>
                      <div className="asset-row-keyline">
                        <code className="font-mono" dir="ltr">
                          {a.assetKey}
                        </code>
                        <span>·</span>
                        <span>{formatBytes(a.byteSize)}</span>
                      </div>
                      <button
                        type="button"
                        className="mt-1.5 truncate rounded-md bg-neutral-100 px-2 py-0.5 text-start font-mono text-[11px] text-indigo-600 transition hover:bg-indigo-50 dark:bg-neutral-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                        dir="ltr"
                        title="העתקת המשתנה"
                        onClick={() => void copyVar(variable)}
                      >
                        {copied === variable ? '✓ הועתק' : variable}
                      </button>
                    </div>

                    <div className="asset-row-actions">
                      <button
                        type="button"
                        className="rounded-md px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
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
                        className="rounded-md px-2.5 py-1 text-xs text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        disabled={busy}
                        onClick={() => void remove(a.assetKey)}
                      >
                        מחק
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-subtle bg-surface-sunken px-4 py-8 text-center text-sm text-neutral-500">
              עדיין לא הועלו נכסים — השתמשו בפאנל ההעלאה
            </p>
          )}
        </div>
      </div>

      <aside className="settings-block lg:sticky lg:top-24">
        <div className="settings-block-head">
          <div className="settings-block-title">העלאת נכס</div>
          <div className="settings-block-desc">מפתח חדש יוצר נכס; מפתח קיים מחליף את הקובץ</div>
        </div>
        <div className="settings-block-body">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-neutral-600">מפתח (אנגלית)</span>
            <input
              type="text"
              className="input !py-2 font-mono text-sm"
              dir="ltr"
              value={uploadKey}
              onChange={(e) => setUploadKey(e.target.value)}
              placeholder="logo"
            />
          </label>

          <label className="mt-3 block text-xs">
            <span className="mb-1 block font-medium text-neutral-600">שם תצוגה</span>
            <input
              type="text"
              className="input !py-2 text-sm"
              value={uploadLabel}
              onChange={(e) => setUploadLabel(e.target.value)}
              placeholder="למשל לוגו רשמי"
            />
          </label>

          {previewVar && (
            <p className="mt-2 text-xs text-neutral-500">
              משתנה:{' '}
              <code className="font-mono text-indigo-600 dark:text-indigo-400" dir="ltr">
                {previewVar}
              </code>
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {QUICK_KEYS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="rounded-lg border border-subtle bg-surface px-2 py-0.5 text-[11px] font-medium text-neutral-600 transition hover:border-indigo-200 hover:text-indigo-700 dark:hover:text-indigo-300"
                onClick={() => applyQuickKey(p.key, p.label)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
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
              className="w-full"
              disabled={busy || !uploadKey.trim()}
              loading={busy && !replaceKey}
              onClick={() => fileRef.current?.click()}
            >
              בחירת תמונה
            </Button>
            <p className="mt-2 text-center text-[11px] text-neutral-400">PNG · JPG · GIF · WEBP — עד 512KB</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
