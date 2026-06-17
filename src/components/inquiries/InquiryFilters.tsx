import { useState } from 'react';
import Button from '../ui/Button.tsx';
import { STATUS_META, PRIORITY_META, type InquiryStatus, type InquiryPriority } from '../../utils/constants.ts';

export interface FilterValues {
  search: string;
  status: InquiryStatus | '';
  priority: InquiryPriority | '';
  group: string;
}

interface InquiryFiltersProps {
  value: FilterValues;
  groups: string[];
  groupLabels?: Record<string, string>;
  onChange: (v: FilterValues) => void;
  onReset: () => void;
}

export default function InquiryFilters({ value, groups, groupLabels = {}, onChange, onReset }: InquiryFiltersProps) {
  const [open, setOpen] = useState(true);

  // Count the dropdown filters that narrow the list (search is always visible).
  const activeCount = [value.status, value.priority, value.group].filter(Boolean).length;
  const hasAny = activeCount > 0 || !!value.search;

  return (
    <section className="card !p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-neutral-500">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={value.search}
            onChange={(e) => onChange({ ...value, search: e.target.value })}
            placeholder="חיפוש בנושא או בתיאור…"
            className="input flex-1 !border-0 !bg-transparent !p-0 focus:!shadow-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn btn-ghost btn-sm gap-1.5"
          aria-expanded={open}
        >
          {open ? 'סגור סינון' : 'הצג סינון'}
          {activeCount > 0 && (
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white tabular-nums">
              {activeCount}
            </span>
          )}
        </button>
      </div>
      {open && (
        <div className="mt-4 grid gap-3 border-t border-subtle pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label">סטטוס</label>
            <select
              className="select"
              value={value.status}
              onChange={(e) => onChange({ ...value, status: e.target.value as InquiryStatus | '' })}
            >
              <option value="">הכל</option>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">דחיפות</label>
            <select
              className="select"
              value={value.priority}
              onChange={(e) => onChange({ ...value, priority: e.target.value as InquiryPriority | '' })}
            >
              <option value="">הכל</option>
              {Object.entries(PRIORITY_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">קבוצה</label>
            <select className="select" value={value.group} onChange={(e) => onChange({ ...value, group: e.target.value })}>
              <option value="">הכל</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {groupLabels[g] || g}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={onReset} className="w-full" disabled={!hasAny}>
              נקה סינון
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
