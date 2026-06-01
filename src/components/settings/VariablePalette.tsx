import { useMemo, useRef, useState } from 'react';
import { EMAIL_VARIABLE_GROUPS, variableLabel } from '../../utils/emailTemplateVars.ts';
import type { AssetVariable } from '../../hooks/useEmailSettings.ts';

interface Props {
  onInsert: (text: string) => void;
  assetVariables?: AssetVariable[];
  autoFocus?: boolean;
}

interface Group {
  title: string;
  accent: boolean;
  items: { key: string; label: string }[];
}

/** Searchable, grouped variable list. Rendered inside the editor's insert popover. */
export default function VariablePalette({ onInsert, assetVariables = [], autoFocus }: Props) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (key: string, label: string) =>
      !q || key.toLowerCase().includes(q) || label.toLowerCase().includes(q);

    const out: Group[] = [];

    if (assetVariables.length) {
      const items = assetVariables
        .filter((v) => match(v.key, v.label))
        .map((v) => ({ key: v.key, label: v.label }));
      if (items.length) out.push({ title: 'נכסים גרפיים', accent: true, items });
    }

    for (const g of EMAIL_VARIABLE_GROUPS) {
      const items = g.keys
        .map((key) => ({ key, label: variableLabel(key) }))
        .filter((it) => match(it.key, it.label));
      if (items.length) out.push({ title: g.title, accent: false, items });
    }

    return out;
  }, [query, assetVariables]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <div className="shrink-0 border-b border-subtle p-2">
        <input
          ref={searchRef}
          type="search"
          autoFocus={autoFocus}
          className="input !py-1.5 !text-sm"
          placeholder="חיפוש שדה…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {total === 0 && (
          <p className="px-2 py-6 text-center text-xs text-neutral-400">לא נמצאו שדות</p>
        )}
        {groups.map((group) => (
          <div key={group.title} className="mb-3 last:mb-0">
            <div
              className={`mb-1 px-1.5 text-[10px] font-bold uppercase tracking-wide ${
                group.accent ? 'text-violet-500' : 'text-neutral-400'
              }`}
            >
              {group.title}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="var-row group"
                  onClick={() => onInsert(`{{${item.key}}}`)}
                >
                  <span className="text-sm text-neutral-700 dark:text-neutral-200">{item.label}</span>
                  <code
                    className={`shrink-0 font-mono text-[11px] ${
                      group.accent
                        ? 'text-violet-600 dark:text-violet-400'
                        : 'text-indigo-600 dark:text-indigo-400'
                    }`}
                    dir="ltr"
                  >
                    {`{{${item.key}}}`}
                  </code>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-subtle px-3 py-1.5 text-[11px] text-neutral-400">
        לחיצה מוסיפה את השדה במקום הסמן
      </div>
    </>
  );
}
