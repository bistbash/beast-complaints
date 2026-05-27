import { useEffect, useState } from 'react';
import useBeastChat, { type ChatConversation } from '../../hooks/useBeastChat.ts';
import ConversationsList from './ConversationsList.tsx';
import ConversationView from './ConversationView.tsx';

const STORAGE_KEY = 'beast_chat_widget_open';

/**
 * Floating chat widget anchored to the bottom-right of the viewport.
 *
 * States:
 *   - closed   → just the floating bubble button (with unread badge)
 *   - open     → panel showing conversations OR an active conversation
 *
 * The widget hits Beast portal directly (cross-origin), reusing the user's SSO
 * JWT. Polling runs only while the panel is open.
 */
export default function ChatWidget() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [activePartner, setActivePartner] = useState<ChatConversation | null>(null);
  const chat = useBeastChat(open);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {}
  }, [open]);

  // Close active partner if we close the whole widget.
  useEffect(() => {
    if (!open) setActivePartner(null);
  }, [open]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 print:hidden">
      {open && (
        <div
          className="card flex h-[min(72vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden !p-0 shadow-elevated fade-in-up"
          role="dialog"
          aria-label="צ'אט"
        >
          <header className="flex items-center justify-between gap-2 border-b border-subtle bg-surface px-3 py-2.5">
            <div className="flex items-center gap-2">
              {activePartner ? (
                <button
                  type="button"
                  onClick={() => setActivePartner(null)}
                  className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  aria-label="חזרה"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
                  <ChatIcon size={16} />
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-tight">
                  {activePartner ? activePartner.displayName : "צ'אט Beast"}
                </div>
                {activePartner ? (
                  <div className="muted truncate text-[11px]">
                    {activePartner.isOnline ? (
                      <span className="text-emerald-600 dark:text-emerald-400">מחובר/ת</span>
                    ) : activePartner.lastSeen ? (
                      `נראה לאחרונה ${formatLastSeen(activePartner.lastSeen)}`
                    ) : (
                      'לא מחובר/ת'
                    )}
                  </div>
                ) : chat.unreadTotal > 0 ? (
                  <div className="muted text-[11px]">
                    {chat.unreadTotal} {chat.unreadTotal === 1 ? 'הודעה' : 'הודעות'} שלא נקראו
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => chat.refresh()}
                className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label="רענן"
                title="רענן"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M3 12a9 9 0 0115.5-6.3M21 4v6h-6M21 12a9 9 0 01-15.5 6.3M3 20v-6h6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label="סגור"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M19 13H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-hidden">
            {activePartner ? (
              <ConversationView
                partner={activePartner}
                getMessages={chat.getMessages}
                sendMessage={chat.sendMessage}
                onMessageSent={chat.refresh}
              />
            ) : (
              <ConversationsList
                conversations={chat.conversations}
                loading={chat.loadingConversations}
                directory={chat.directory}
                loadingDirectory={chat.loadingDirectory}
                loadDirectory={chat.loadDirectory}
                onSelect={setActivePartner}
              />
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-12 w-12 items-center justify-center rounded-full text-white shadow-elevated transition ${
          open
            ? 'bg-neutral-700 hover:bg-neutral-800'
            : 'bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 hover:opacity-90'
        }`}
        aria-label={open ? 'סגור צ\'אט' : 'פתח צ\'אט'}
        aria-expanded={open}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <ChatIcon size={20} />
        )}
        {!open && chat.unreadTotal > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white shadow">
            {chat.unreadTotal > 99 ? '99+' : chat.unreadTotal}
          </span>
        )}
      </button>
    </div>
  );
}

function ChatIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatLastSeen(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'כעת';
    if (mins < 60) return `לפני ${mins} דק'`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `לפני ${hours} שע'`;
    return d.toLocaleDateString('he-IL');
  } catch {
    return '';
  }
}
