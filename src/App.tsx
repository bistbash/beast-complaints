import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import useBeastSSO from './hooks/useBeastSSO.ts';
import useCapabilities from './hooks/useCapabilities.ts';
import useTheme from './hooks/useTheme.ts';
import Navbar from './components/layout/Navbar.tsx';
import LoadingScreen from './components/layout/LoadingScreen.tsx';
import ErrorShell from './components/layout/ErrorShell.tsx';

// Route-level code splitting — keeps the initial bundle small. The admin-only
// settings studio (PDF/letter editor) in particular is heavy and rarely needed.
const InboxPage = lazy(() => import('./pages/InboxPage.tsx'));
const InquiryDetailPage = lazy(() => import('./pages/InquiryDetailPage.tsx'));
const ClosedInquiriesPage = lazy(() => import('./pages/ClosedInquiriesPage.tsx'));
const StatsPage = lazy(() => import('./pages/StatsPage.tsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.tsx'));
const ChatWidget = lazy(() => import('./components/chat/ChatWidget.tsx'));

export default function App() {
  useTheme();
  const { user, loading, authenticated, logout, ssoConfigError } = useBeastSSO();
  const authReady = authenticated && !loading;
  const { capabilities, loading: capsLoading } = useCapabilities(authReady);

  if (ssoConfigError) {
    return <ErrorShell title="תצורת SSO" description={ssoConfigError} />;
  }

  if (loading || !authenticated || capsLoading) {
    return <LoadingScreen message={loading || !authenticated ? 'מתחבר ל-Beast…' : 'טוען הרשאות…'} />;
  }

  return (
    <>
      <Navbar user={user} capabilities={capabilities} onLogout={logout} />
      <main className="flex-1">
        <Suspense fallback={<LoadingScreen message="טוען…" />}>
          <Routes>
            <Route path="/" element={<Navigate to="/inbox" replace />} />
            <Route path="/inbox" element={<InboxPage view="inbox" />} />
            <Route path="/inquiries/:id" element={<InquiryDetailPage />} />
            <Route path="/closed" element={<ClosedInquiriesPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* Backwards-compat: old direct links → scope chips. */}
            <Route path="/mine" element={<Navigate to="/inbox?scope=mine_assigned" replace />} />
            <Route path="/routing" element={<Navigate to="/inbox?scope=unrouted" replace />} />
            <Route path="/manager-queue" element={<Navigate to="/inbox?scope=awaiting_manager" replace />} />
            <Route
              path="*"
              element={
                <ErrorShell
                  title="הדף לא נמצא"
                  description="הדף שניסית להגיע אליו אינו קיים."
                  actionLabel="חזרה לתיבת הפניות"
                  actionTo="/inbox"
                />
              }
            />
          </Routes>
        </Suspense>
      </main>
      <Suspense fallback={null}>
        <ChatWidget />
      </Suspense>
    </>
  );
}
