import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Avatar from '../ui/Avatar.tsx';
import ThemeToggle from '../ui/ThemeToggle.tsx';
import BrandMark from './BrandMark.tsx';
import type { Capabilities } from '../../hooks/useCapabilities.ts';
import { humanizeIdentifier } from '../../utils/format.ts';

interface NavbarProps {
  user: {
    username?: string;
    displayName?: string;
    email?: string;
    avatarUrl?: string | null;
  } | null;
  capabilities: Capabilities | null;
  onLogout: () => void;
}

interface NavItem {
  to: string;
  label: string;
  show: (c: Capabilities | null) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/inbox', label: 'פניות פתוחות', show: () => true },
  { to: '/closed', label: 'סגורות', show: () => true },
  { to: '/stats', label: 'סטטיסטיקות', show: (c) => !!(c?.isAdmin || c?.isNavigator || c?.isManager) },
  { to: '/settings', label: 'ניהול', show: (c) => !!c?.canManageEmail },
];

export default function Navbar({ user, capabilities, onLogout }: NavbarProps) {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const visibleItems = NAV_ITEMS.filter((item) => item.show(capabilities));
  const userLabel = user?.displayName || humanizeIdentifier(user?.email || user?.username);

  return (
    <header className="sticky top-0 z-40 border-b border-subtle bg-surface/95 backdrop-blur">
      <div className="container-max flex h-16 items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-2 transition hover:opacity-90"
          onClick={() => navigate('/inbox')}
        >
          <BrandMark size={36} />
          <div className="flex flex-col items-start leading-tight">
            <span className="text-sm font-bold tracking-tight">פניות לקוח</span>
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">Beast Complaints</span>
          </div>
        </button>

        <nav className="mx-auto hidden items-center gap-1 md:flex">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full border border-subtle px-2 py-1 transition hover:bg-neutral-50 dark:hover:bg-neutral-800"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="תפריט משתמש"
            >
              <Avatar name={userLabel} src={user?.avatarUrl} size={28} />
              <span className="hidden text-sm font-medium lg:block">{userLabel}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute left-0 mt-2 w-72 rounded-xl border border-subtle bg-surface p-3 shadow-elevated fade-in-up">
                <div className="flex items-center gap-3 border-b border-subtle pb-3">
                  <Avatar name={userLabel} src={user?.avatarUrl} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{userLabel}</div>
                    <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">{user?.email || '—'}</div>
                  </div>
                </div>
                {capabilities && (
                  <div className="flex flex-wrap gap-1 py-3">
                    {capabilities.isAdmin && (
                      <span className="pill bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-900">
                        מנהל מערכת
                      </span>
                    )}
                    {capabilities.isManager && !capabilities.isAdmin && (
                      <span className="pill bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900">
                        מנהל
                      </span>
                    )}
                    {capabilities.isNavigator && (
                      <span className="pill bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900">
                        נע"ט פניות לקוח
                      </span>
                    )}
                    {capabilities.isKeva && (
                      <span className="pill bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-900">
                        קבע
                      </span>
                    )}
                    {!capabilities.isAdmin && !capabilities.isManager && !capabilities.isNavigator && !capabilities.isKeva && (
                      <span className="pill pill-neutral">חבר צוות</span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                  className="btn btn-ghost w-full text-rose-600 dark:text-rose-400"
                >
                  התנתק
                </button>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          className="ml-auto rounded-md border border-subtle p-2 md:hidden"
          aria-label="תפריט"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? '✕' : '☰'}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-subtle bg-surface md:hidden">
          <div className="container-max flex flex-col gap-1 py-2">
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                      : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-subtle pt-3">
              <div className="flex items-center gap-2">
                <Avatar name={userLabel} src={user?.avatarUrl} size={32} />
                <div className="text-sm">
                  <div className="font-semibold leading-tight">{userLabel}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{user?.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <button type="button" onClick={onLogout} className="btn btn-ghost btn-sm">
                  התנתק
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
