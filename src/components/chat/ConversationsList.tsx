import { useEffect, useMemo, useState } from 'react';
import type { ChatConversation, DirectoryUser } from '../../hooks/useBeastChat.ts';
import Avatar from '../ui/Avatar.tsx';

interface Props {
  conversations: ChatConversation[];
  loading: boolean;
  directory: DirectoryUser[];
  loadingDirectory: boolean;
  loadDirectory: () => Promise<DirectoryUser[]>;
  onSelect: (c: ChatConversation) => void;
}

export default function ConversationsList({
  conversations,
  loading,
  directory,
  loadingDirectory,
  loadDirectory,
  onSelect,
}: Props) {
  const [search, setSearch] = useState('');

  const trimmed = search.trim().toLowerCase();

  // Lazily fetch the AD directory the first time the user types something.
  useEffect(() => {
    if (trimmed.length > 0 && directory.length === 0 && !loadingDirectory) {
      void loadDirectory();
    }
  }, [trimmed, directory.length, loadingDirectory, loadDirectory]);

  const filteredConversations = useMemo(() => {
    if (!trimmed) return conversations;
    return conversations.filter(
      (c) =>
        c.displayName.toLowerCase().includes(trimmed) ||
        c.username.toLowerCase().includes(trimmed) ||
        c.lastMessage.toLowerCase().includes(trimmed),
    );
  }, [conversations, trimmed]);

  // Directory matches that are NOT already in the conversations list — these
  // are "start a new chat" candidates.
  const newContactMatches = useMemo(() => {
    if (!trimmed) return [] as DirectoryUser[];
    const existing = new Set(conversations.map((c) => c.username.toLowerCase()));
    return directory
      .filter((u) => !existing.has(u.username.toLowerCase()))
      .filter(
        (u) =>
          u.displayName.toLowerCase().includes(trimmed) ||
          u.username.toLowerCase().includes(trimmed) ||
          (u.email || '').toLowerCase().includes(trimmed),
      )
      .slice(0, 20);
  }, [trimmed, directory, conversations]);

  function startNewConversation(user: DirectoryUser) {
    const partner: ChatConversation = {
      username: user.username,
      displayName: user.displayName,
      email: user.email ?? null,
      lastMessage: '',
      lastMessageAt: null,
      unreadCount: 0,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      isFromMe: false,
    };
    onSelect(partner);
  }

  const showEmptyState = !loading && conversations.length === 0 && !trimmed;
  const showNoResults =
    !!trimmed && filteredConversations.length === 0 && newContactMatches.length === 0 && !loadingDirectory;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-subtle bg-surface px-3 py-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש שיחה או איש קשר…"
          className="input !py-1.5 text-sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && conversations.length === 0 && (
          <div className="space-y-2 p-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="skeleton h-9 w-9 rounded-full" />
                <div className="flex-1">
                  <div className="skeleton h-3 w-1/2" />
                  <div className="skeleton mt-1 h-2.5 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {showEmptyState && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-sm font-medium">אין שיחות עדיין</p>
            <p className="muted text-xs leading-relaxed">חפש לפי שם כדי להתחיל שיחה חדשה.</p>
          </div>
        )}

        {filteredConversations.length > 0 && (
          <>
            {trimmed && (
              <SectionLabel>שיחות קיימות</SectionLabel>
            )}
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {filteredConversations.map((c) => (
                <li key={c.username}>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className="flex w-full items-start gap-3 px-3 py-2.5 text-right transition hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  >
                    <div className="relative flex-shrink-0">
                      <Avatar name={c.displayName} size={38} />
                      {c.isOnline && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-emerald-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{c.displayName}</span>
                        {c.lastMessageAt && (
                          <span className="muted whitespace-nowrap text-[11px]">
                            {formatTime(c.lastMessageAt)}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span
                          className={`truncate text-xs ${
                            c.unreadCount > 0
                              ? 'font-semibold text-neutral-900 dark:text-neutral-100'
                              : 'text-neutral-500'
                          }`}
                        >
                          {c.isFromMe ? 'אתה: ' : ''}
                          {c.lastMessage || 'אין הודעות'}
                        </span>
                        {c.unreadCount > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                            {c.unreadCount > 99 ? '99+' : c.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {trimmed && (
          <>
            <SectionLabel>
              התחל שיחה חדשה
              {loadingDirectory && (
                <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
              )}
            </SectionLabel>
            {newContactMatches.length === 0 && loadingDirectory && (
              <div className="px-3 py-2">
                <div className="skeleton h-9 w-full" />
              </div>
            )}
            {newContactMatches.length > 0 && (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {newContactMatches.map((u) => (
                  <li key={u.username}>
                    <button
                      type="button"
                      onClick={() => startNewConversation(u)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-right transition hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                    >
                      <div className="relative flex-shrink-0">
                        <Avatar name={u.displayName} size={36} />
                        {u.isOnline && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-emerald-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{u.displayName}</div>
                        <div className="muted truncate text-[11px]">
                          {u.email || u.username}
                        </div>
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                        התחל שיחה
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {showNoResults && (
          <div className="flex flex-col items-center justify-center gap-1 p-6 text-center">
            <p className="text-sm font-medium">לא נמצאו תוצאות</p>
            <p className="muted text-xs">לא נמצא איש קשר התואם ל-"{search.trim()}".</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-[1] flex items-center bg-surface-elevated/90 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500 backdrop-blur">
      {children}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'אתמול';
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}
