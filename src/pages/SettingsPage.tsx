import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import useCapabilities from '../hooks/useCapabilities.ts';
import { useEmailSettings } from '../hooks/useEmailSettings.ts';
import { useToast } from '../hooks/useToast.ts';
import LoadingScreen from '../components/layout/LoadingScreen.tsx';
import LetterStudio from '../components/settings/LetterStudio.tsx';
import AssetsManager from '../components/settings/AssetsManager.tsx';
import ConnectionPanel from '../components/settings/ConnectionPanel.tsx';

type Section = 'letters' | 'assets' | 'connection';

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'ההרשאה ב-Google בוטלה',
  missing_code: 'חסר קוד אימות',
  invalid_state: 'פג תוקף — נסו שוב',
  encryption_not_configured: 'שמרו הגדרות OAuth לפני חיבור',
  missing_refresh_token: 'נסו להתנתק מ-Google ולחבר מחדש',
  insufficient_scopes:
    'הרשאות Gmail לא מספיקות — נתקו את האפליקציה בחשבון Google (אבטחה → גישה של צד שלישי) וחברו מחדש',
};

const NAV: { id: Section; title: string; sub: string; icon: ReactNode }[] = [
  {
    id: 'letters',
    title: 'מכתבי סגירה',
    sub: 'עיצוב ותצוגה',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'assets',
    title: 'נכסים גרפיים',
    sub: 'לוגו וחתימה',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="9" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 17l4.5-4 3 2.5L16 11l3 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'connection',
    title: 'חיבור ושליחה',
    sub: 'Gmail · OAuth',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4 8l8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function SettingsPage() {
  const { capabilities, loading: capsLoading } = useCapabilities();
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useEmailSettings();
  const { toast, notify, dismiss } = useToast();
  const [section, setSection] = useState<Section>('letters');

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected === '1') {
      notify('ok', 'Gmail חובר בהצלחה');
      setSection('connection');
      void settings.reloadStatus();
      setSearchParams({}, { replace: true });
    } else if (error) {
      notify('err', OAUTH_ERRORS[error] || `שגיאה: ${error}`);
      setSection('connection');
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (capsLoading) return <LoadingScreen message="טוען…" />;
  if (!capabilities?.canManageEmail) return <Navigate to="/inbox" replace />;
  if (settings.loading) return <LoadingScreen message="טוען הגדרות…" />;
  if (settings.failed || !settings.status) {
    return (
      <div className="container-max py-10">
        <p className="muted text-sm">לא ניתן לטעון את ההגדרות. רעננו את הדף ונסו שוב.</p>
      </div>
    );
  }

  return (
    <div className="settings-shell pb-12">
      <div className="settings-container pt-6 md:pt-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">ניהול</h1>
            <p className="muted mt-1 text-sm">מכתבי סגירה, נכסים גרפיים וחיבור Gmail</p>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
              settings.status.connected
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                settings.status.connected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            {settings.status.connected ? 'Gmail פעיל' : 'Gmail לא מחובר'}
          </span>
        </header>

        <div className="settings-grid">
          <nav className="settings-nav" aria-label="מקטעי ניהול">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className="settings-nav-item"
                data-active={section === item.id}
                onClick={() => setSection(item.id)}
              >
                <span className="settings-nav-icon">{item.icon}</span>
                <span>
                  <span className="settings-nav-title">{item.title}</span>
                  <span className="settings-nav-sub">{item.sub}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="min-w-0">
            {section === 'letters' && <LetterStudio settings={settings} notify={notify} />}
            {section === 'assets' && (
              <div className="max-w-5xl">
                <AssetsManager settings={settings} notify={notify} />
              </div>
            )}
            {section === 'connection' && (
              <div className="max-w-3xl">
                <ConnectionPanel settings={settings} notify={notify} adminEmail={capabilities.email} />
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className={`toast ${
            toast.tone === 'ok'
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white'
          }`}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            className="opacity-70 transition hover:opacity-100"
            onClick={dismiss}
            aria-label="סגור"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
