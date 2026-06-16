import { useState } from 'react';
import Avatar from '../ui/Avatar.tsx';
import Button from '../ui/Button.tsx';
import { formatDateTime, formatRelative, humanizeIdentifier } from '../../utils/format.ts';
import { MESSAGE_TYPE, type MessageType } from '../../utils/constants.ts';

interface Message {
  id: string;
  inquiry_id: string;
  author: string;
  author_name: string | null;
  content: string;
  message_type: MessageType;
  created_at: string;
}

interface MessageThreadProps {
  messages: Message[];
  displayNames?: Record<string, string>;
  currentUserEmail?: string;
  onPost?: (content: string) => Promise<void>;
  disabled?: boolean;
}

function messageTone(type: MessageType): string {
  switch (type) {
    case MESSAGE_TYPE.SYSTEM:
      return 'border-l-4 border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/40';
    case MESSAGE_TYPE.ROUTING:
      return 'border-l-4 border-violet-300 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/30';
    case MESSAGE_TYPE.STATUS_CHANGE:
      return 'border-l-4 border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/30';
    case MESSAGE_TYPE.TEAM_RESPONSE:
      return 'border-l-4 border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40';
    case MESSAGE_TYPE.MANAGER_RESPONSE:
      return 'border-l-4 border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40';
    default:
      return 'border border-subtle bg-surface';
  }
}

export default function MessageThread({
  messages,
  displayNames = {},
  currentUserEmail,
  onPost,
  disabled,
}: MessageThreadProps) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handlePost() {
    if (!draft.trim() || !onPost) return;
    setSubmitting(true);
    try {
      await onPost(draft.trim());
      setDraft('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {messages.length === 0 && (
        <p className="muted text-sm">אין עדיין הודעות בפנייה זו.</p>
      )}
      {messages.map((m) => {
        const isMine = currentUserEmail && m.author?.toLowerCase() === currentUserEmail.toLowerCase();
        const name = m.author_name || displayNames[m.author?.toLowerCase()] || humanizeIdentifier(m.author);
        return (
          <div
            key={m.id}
            className={`rounded-xl p-3 ${messageTone(m.message_type)} fade-in-up`}
          >
            <div className="flex items-start gap-3">
              <Avatar name={name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold">{name}</span>
                  {isMine && <span className="text-[10px] text-neutral-500">(אני)</span>}
                  <time
                    className="text-xs text-neutral-500"
                    title={formatDateTime(m.created_at)}
                  >
                    {formatRelative(m.created_at)}
                  </time>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
              </div>
            </div>
          </div>
        );
      })}

      {onPost && (
        <div className="card !p-3">
          <textarea
            className="textarea"
            placeholder="כתוב תגובה…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={disabled || submitting}
            rows={3}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              {draft.length > 0 && `${draft.length} תווים`}
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={handlePost}
              loading={submitting}
              disabled={disabled || !draft.trim()}
            >
              שלח תגובה
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
