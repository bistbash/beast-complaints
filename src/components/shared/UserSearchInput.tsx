import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../ui/Avatar.tsx';

export interface UserSearchOption {
  username: string;
  email: string | null;
  displayName: string;
  avatarUrl?: string | null;
  suggestedGroup?: string | null;
  isManager?: boolean;
}

interface UserSearchInputProps {
  value: string;
  displayName: string;
  avatarUrl?: string | null;
  users: UserSearchOption[];
  loading?: boolean;
  label?: string;
  placeholder?: string;
  onChange: (user: {
    identity: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    suggestedGroup?: string | null;
  }) => void;
  onClear?: () => void;
}

export default function UserSearchInput({
  value,
  displayName,
  avatarUrl,
  users,
  loading = false,
  label,
  placeholder = 'חפש לפי שם…',
  onChange,
}: UserSearchInputProps) {
  const [query, setQuery] = useState(displayName || value || '');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (displayName) setQuery(displayName);
    else if (value && !displayName) setQuery(value);
  }, [value, displayName]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return users
      .filter((u) => {
        const un = (u.username || '').toLowerCase();
        const dn = (u.displayName || '').toLowerCase();
        const em = (u.email || '').toLowerCase();
        return un.includes(q) || dn.includes(q) || em.includes(q);
      })
      .slice(0, 20);
  }, [query, users]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    if (value) {
      onChange({ identity: '', username: '', displayName: '', avatarUrl: null });
    }
    setOpen(v.trim().length >= 2);
  }

  function handleSelect(user: UserSearchOption) {
    const identity = user.email || `${user.username}@local`;
    setQuery(user.displayName || user.username);
    setOpen(false);
    onChange({
      identity,
      username: user.username,
      displayName: user.displayName || user.username,
      avatarUrl: user.avatarUrl || null,
      suggestedGroup: user.suggestedGroup,
    });
  }

  function handleFocus() {
    if (query.trim().length >= 2 && filtered.length > 0) setOpen(true);
  }

  const showSelectedAvatar = value && (avatarUrl || displayName);

  return (
    <div ref={wrapperRef} className="relative">
      {label && <label className="field-label">{label}</label>}
      <div className="relative">
        {showSelectedAvatar && (
          <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center">
            <Avatar name={displayName || value} src={avatarUrl} size={24} />
          </div>
        )}
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          className={`input ${showSelectedAvatar ? '!pr-11' : ''}`}
          placeholder={loading ? 'טוען משתמשים…' : placeholder}
          autoComplete="off"
        />
        {loading && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-200 border-t-indigo-500 dark:border-neutral-700 dark:border-t-indigo-400" />
          </div>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-subtle bg-surface shadow-elevated">
          {filtered.map((user) => (
            <button
              key={user.email || user.username}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(user)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-right transition first:rounded-t-xl last:rounded-b-xl hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
            >
              <Avatar name={user.displayName || user.username} src={user.avatarUrl} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {user.displayName}
                  {user.isManager ? ' (מנהל)' : ''}
                </p>
                <p className="muted truncate font-mono text-xs">{user.username}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && filtered.length === 0 && query.trim().length >= 2 && !loading && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-subtle bg-surface px-4 py-3 shadow-elevated">
          <p className="muted text-center text-sm">לא נמצאו תוצאות</p>
        </div>
      )}
    </div>
  );
}
