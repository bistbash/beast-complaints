import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatConversation, ChatMessage } from '../../hooks/useBeastChat.ts';
import Button from '../ui/Button.tsx';

interface Props {
  partner: ChatConversation;
  getMessages: (partner: string) => Promise<ChatMessage[]>;
  sendMessage: (partner: string, text: string) => Promise<ChatMessage | null>;
  onMessageSent: () => void;
}

export default function ConversationView({ partner, getMessages, sendMessage, onMessageSent }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<string | null>(null);

  // Cheap "who am I" detection: read the cached SSO user blob.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('beast_complaints_user');
      if (raw) {
        const u = JSON.parse(raw) as { username?: string };
        meRef.current = u.username || null;
      }
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await getMessages(partner.username);
    setMessages(list);
    setLoading(false);
  }, [getMessages, partner.username]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  // Auto-scroll to bottom when messages arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const created = await sendMessage(partner.username, text);
    setSending(false);
    if (created) {
      setMessages((prev) => [...prev, created]);
      setDraft('');
      onMessageSent();
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto bg-neutral-50 px-3 py-3 dark:bg-neutral-900/30">
        {loading && messages.length === 0 && (
          <div className="muted text-center text-xs">טוען הודעות…</div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="muted text-xs">אין עדיין הודעות. כתוב הודעה ראשונה למטה.</p>
          </div>
        )}
        <ul className="space-y-2">
          {messages.map((m, idx) => {
            const isMe = meRef.current
              ? m.from_username === meRef.current
              : m.from_username !== partner.username;
            const showDate = shouldShowDate(messages, idx);
            return (
              <li key={m.id ?? idx}>
                {showDate && (
                  <div className="my-3 text-center">
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {formatDate(m.created_at)}
                    </span>
                  </div>
                )}
                <div className={`flex ${isMe ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm shadow-sm ${
                      isMe
                        ? 'rounded-bl-md bg-indigo-600 text-white'
                        : 'rounded-br-md bg-surface text-neutral-900 dark:text-neutral-100'
                    }`}
                  >
                    {m.message && <p className="whitespace-pre-wrap break-words leading-snug">{m.message}</p>}
                    {m.file_url && !m.message && (
                      <a
                        href={m.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className={`text-xs underline ${isMe ? 'text-indigo-100' : 'text-indigo-600'}`}
                      >
                        {m.file_name || 'קובץ'}
                      </a>
                    )}
                    <div
                      className={`mt-0.5 text-[10px] ${isMe ? 'text-indigo-200' : 'text-neutral-500'}`}
                      dir="ltr"
                    >
                      {formatTime(m.created_at)}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-subtle bg-surface p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            placeholder="כתוב הודעה…"
            rows={1}
            className="textarea max-h-28 min-h-[36px] flex-1 resize-none !py-2 text-sm"
            disabled={sending}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            loading={sending}
          >
            שלח
          </Button>
        </div>
        <p className="muted mt-1 text-[10px]">Enter לשליחה · Shift+Enter לשורה חדשה</p>
      </div>
    </div>
  );
}

function shouldShowDate(messages: ChatMessage[], idx: number): boolean {
  if (idx === 0) return true;
  const prev = new Date(messages[idx - 1].created_at);
  const curr = new Date(messages[idx].created_at);
  return prev.toDateString() !== curr.toDateString();
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'היום';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'אתמול';
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}
