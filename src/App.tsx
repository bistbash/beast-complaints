import { Navigate, Route, Routes } from 'react-router-dom';
import useBeastSSO from './hooks/useBeastSSO.ts';
import useCapabilities from './hooks/useCapabilities.ts';
import useTheme from './hooks/useTheme.ts';
import Navbar from './components/layout/Navbar.tsx';
import LoadingScreen from './components/layout/LoadingScreen.tsx';
import ErrorShell from './components/layout/ErrorShell.tsx';
import InboxPage from './pages/InboxPage.tsx';
import InquiryDetailPage from './pages/InquiryDetailPage.tsx';
import ClosedInquiriesPage from './pages/ClosedInquiriesPage.tsx';
import StatsPage from './pages/StatsPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import ChatWidget from './components/chat/ChatWidget.tsx';

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
      </main>
      <ChatWidget />
    </>
  );
}
