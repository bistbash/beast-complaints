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

const SECTION_IDS: Section[] = ['letters', 'assets', 'connection'];

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'ההרשאה ב-Google בוטלה',
  missing_code: 'חסר קוד אימות',
  invalid_state: 'פג תוקף — נסו שוב',
  encryption_not_configured: 'שמרו הגדרות OAuth לפני חיבור',
  missing_refresh_token: 'נסו להתנתק מ-Google ולחבר מחדש',
  insufficient_scopes:
    'הרשאות Gmail לא מספיקות — נתקו את האפליקציה בחשבון Google (אבטחה → גישה של צד שלישי) וחברו מחדש',
};

const SECTION_META: Record<Section, { title: string; desc: string }> = {
  letters: {
    title: 'מכתבי סגירה',
    desc: 'תבנית HTML נפרדת לפנייה מוצדקת ולא מוצדקת. ערכו, שמרו טיוטות ופרסמו את הנוסח הפעיל.',
  },
  assets: {
    title: 'נכסים גרפיים',
    desc: 'תמונות (לוגו, חתימה ועוד) עם מפתח באנגלית. כל נכס הופך למשתנה {{asset_<מפתח>}} בתבנית.',
  },
  connection: {
    title: 'חיבור ושליחה',
    desc: 'חשבון Gmail משותף לשליחת מכתבי הסגירה, זהות השולח והגדרות OAuth.',
  },
};

const NAV: { id: Section; title: string; sub: string; icon: ReactNode }[] = [
  {
    id: 'letters',
    title: 'מכתבי סגירה',
    sub: 'תבניות וטיוטות',
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

function parseSection(raw: string | null): Section {
  return SECTION_IDS.includes(raw as Section) ? (raw as Section) : 'letters';
}

export default function SettingsPage() {
  const { capabilities, loading: capsLoading } = useCapabilities();
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useEmailSettings();
  const { toast, notify, dismiss } = useToast();
  const [section, setSection] = useState<Section>(() => parseSection(searchParams.get('tab')));

  const goTo = (next: Section) => {
    setSection(next);
    setSearchParams({ tab: next }, { replace: true });
  };

  useEffect(() => {
    const tab = parseSection(searchParams.get('tab'));
    setSection(tab);
  }, [searchParams]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected === '1') {
      notify('ok', 'Gmail חובר בהצלחה');
      setSection('connection');
      void settings.reloadStatus();
      setSearchParams({ tab: 'connection' }, { replace: true });
    } else if (error) {
      notify('err', OAUTH_ERRORS[error] || `שגיאה: ${error}`);
      setSection('connection');
      setSearchParams({ tab: 'connection' }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const navBadge = (id: Section): string | null => {
    if (id === 'letters') {
      const n = settings.drafts.length;
      return n > 0 ? String(n) : null;
    }
    if (id === 'assets') return settings.assets.length > 0 ? String(settings.assets.length) : null;
    return null;
  };

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

  const meta = SECTION_META[section];
  const emailStatus = settings.status;

  return (
    <div className="settings-shell pb-12">
      <div className="settings-container pt-6 md:pt-8">
        <header className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">ניהול</h1>
          <p className="muted mt-1 text-sm">מכתבי סגירה, נכסים גרפיים וחיבור Gmail</p>
        </header>

        <div className="settings-grid">
          <nav className="settings-nav" aria-label="מקטעי ניהול">
            {NAV.map((item) => {
              const badge = navBadge(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="settings-nav-item"
                  data-active={section === item.id}
                  onClick={() => goTo(item.id)}
                >
                  <span className="settings-nav-icon">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="settings-nav-title">{item.title}</span>
                    <span className="settings-nav-sub">{item.sub}</span>
                  </span>
                  {badge && <span className="settings-nav-badge">{badge}</span>}
                  {item.id === 'connection' && (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        emailStatus.connected ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            <div className="settings-section-head">
              <h2 className="settings-section-title">{meta.title}</h2>
              <p className="settings-section-desc">{meta.desc}</p>
            </div>

            {section === 'letters' && <LetterStudio settings={settings} notify={notify} />}
            {section === 'assets' && <AssetsManager settings={settings} notify={notify} />}
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
