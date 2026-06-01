import { useEffect, useState } from 'react';
import Button from '../ui/Button.tsx';
import type { EmailSettings } from '../../hooks/useEmailSettings.ts';
import type { Notify } from '../../hooks/useToast.ts';

interface Props {
  settings: EmailSettings;
  notify: Notify;
  adminEmail: string;
}

function generateEncryptionKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function ConnectionPanel({ settings, notify, adminEmail }: Props) {
  const { status, saveCredentials, startOAuth, disconnect, sendTest } = settings;
  const creds = status?.credentials;
  const configOk = !!status?.googleConfigured && !!status?.encryptionConfigured;

  const [advancedOpen, setAdvancedOpen] = useState(!creds?.configured);
  const [busy, setBusy] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [tokenEncryptionKey, setTokenEncryptionKey] = useState('');
  const [oauthRedirectUri, setOauthRedirectUri] = useState('');
  const [emailFromName, setEmailFromName] = useState('');

  useEffect(() => {
    setGoogleClientId(creds?.googleClientId || '');
    setOauthRedirectUri(creds?.oauthRedirectUri || '');
    setEmailFromName(creds?.emailFromName || '');
  }, [creds?.googleClientId, creds?.oauthRedirectUri, creds?.emailFromName]);

  if (!status || !creds) return null;

  const redirectHint = oauthRedirectUri.trim() || creds.suggestedRedirectUri;

  const save = async () => {
    setBusy(true);
    const res = await saveCredentials({
      googleClientId: googleClientId.trim(),
      googleClientSecret: googleClientSecret.trim() || undefined,
      tokenEncryptionKey: tokenEncryptionKey.trim() || undefined,
      oauthRedirectUri: oauthRedirectUri.trim() || null,
      emailFromName: emailFromName.trim() || null,
    });
    setBusy(false);
    if (res.ok) {
      setGoogleClientSecret('');
      setTokenEncryptionKey('');
      notify('ok', 'הגדרות נשמרו');
    } else {
      notify('err', res.error || 'שמירה נכשלה');
    }
  };

  const connect = async () => {
    setBusy(true);
    const res = await startOAuth();
    setBusy(false);
    if (res.ok && res.data) window.location.href = res.data;
    else notify('err', res.error || 'לא ניתן להתחיל חיבור');
  };

  const doDisconnect = async () => {
    if (!confirm('לנתק את חשבון Gmail?')) return;
    setBusy(true);
    const res = await disconnect();
    setBusy(false);
    notify(res.ok ? 'ok' : 'err', res.ok ? 'החשבון נותק' : res.error || 'ניתוק נכשל');
  };

  const test = async () => {
    setBusy(true);
    const res = await sendTest();
    setBusy(false);
    notify(res.ok ? 'ok' : 'err', res.ok ? `מייל בדיקה נשלח ל-${adminEmail}` : res.error || 'שליחה נכשלה');
  };

  return (
    <div className="surface-card p-5 md:p-6">
      <h2 className="text-lg font-bold tracking-tight">חיבור Gmail</h2>
      <p className="muted mt-1 text-sm">חשבון משותף שדרכו נשלחים מכתבי הסגירה לפונים</p>

      {/* Status hero */}
      <div className="mt-5 flex flex-col gap-4 rounded-xl border border-subtle bg-surface-sunken p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
              status.connected
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800'
            }`}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 6h16v12H4V6zm0-1a1 1 0 00-1 1v12a1 1 0 001 1h16a1 1 0 001-1V6a1 1 0 00-1-1H4z"
                fill="currentColor"
              />
              <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{status.connected ? 'מחובר' : 'לא מחובר'}</div>
            <div className="truncate font-mono text-xs text-neutral-500" dir="ltr">
              {status.connected ? status.gmailAddress : 'נדרש חיבור לפני שליחה'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {status.connected ? (
            <>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void test()}>
                מייל בדיקה
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void doDisconnect()}>
                נתק
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" disabled={busy || !configOk} onClick={() => void connect()}>
              התחבר עם Google
            </Button>
          )}
        </div>
      </div>

      {!configOk && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          השלימו את הגדרות OAuth למטה ושמרו לפני החיבור.
        </p>
      )}

      <button
        type="button"
        className="mt-5 flex w-full items-center justify-between rounded-xl border border-subtle bg-surface-elevated px-4 py-3 text-sm font-medium transition hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
        onClick={() => setAdvancedOpen((v) => !v)}
      >
        <span>הגדרות Google OAuth</span>
        <span className="text-neutral-400" aria-hidden>
          {advancedOpen ? '▲' : '▼'}
        </span>
      </button>

      {advancedOpen && (
        <div className="mt-3 grid gap-3 rounded-xl border border-subtle bg-surface-sunken p-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Client ID</span>
            <input
              type="text"
              className="input font-mono text-xs"
              dir="ltr"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Client Secret</span>
            <input
              type="password"
              className="input font-mono text-xs"
              dir="ltr"
              value={googleClientSecret}
              onChange={(e) => setGoogleClientSecret(e.target.value)}
              placeholder={creds.hasClientSecret ? 'ללא שינוי' : ''}
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex justify-between text-xs font-medium text-neutral-500">
              <span>מפתח הצפנה</span>
              <button
                type="button"
                className="text-indigo-600 hover:underline dark:text-indigo-400"
                onClick={() => setTokenEncryptionKey(generateEncryptionKey())}
              >
                צור מפתח
              </button>
            </span>
            <input
              type="password"
              className="input font-mono text-xs"
              dir="ltr"
              value={tokenEncryptionKey}
              onChange={(e) => setTokenEncryptionKey(e.target.value)}
              placeholder={creds.hasEncryptionKey ? 'ללא שינוי' : ''}
              autoComplete="new-password"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-500">Redirect URI</span>
            <input
              type="text"
              className="input font-mono text-xs"
              dir="ltr"
              value={oauthRedirectUri}
              onChange={(e) => setOauthRedirectUri(e.target.value)}
              placeholder={creds.suggestedRedirectUri}
            />
            <p className="mt-1.5 break-all font-mono text-[10px] text-neutral-400" dir="ltr">
              {redirectHint}
            </p>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-neutral-500">שם שולח</span>
            <input
              type="text"
              className="input"
              value={emailFromName}
              onChange={(e) => setEmailFromName(e.target.value)}
            />
          </label>
          <div className="sm:col-span-2">
            <Button type="button" size="sm" disabled={busy} loading={busy} onClick={() => void save()}>
              שמירת הגדרות
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
