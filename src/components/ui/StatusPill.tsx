import React from 'react';
import { STATUS_META, type InquiryStatus } from '../../utils/constants.ts';

interface StatusPillProps {
  status: InquiryStatus | string;
  size?: 'sm' | 'md';
}

const TONE_CLASS: Record<string, string> = {
  neutral:
    'bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:border-neutral-700',
  info:
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900',
  warning:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  success:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  danger:
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  accent:
    'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-900',
};

export default function StatusPill({ status, size = 'md' }: StatusPillProps) {
  const meta = STATUS_META[status as InquiryStatus];
  const label = meta?.label || String(status);
  const tone = meta?.tone || 'neutral';
  const sizeClass = size === 'sm' ? 'text-[10.5px] px-2 py-0.5' : '';
  return (
    <span className={`pill ${TONE_CLASS[tone]} ${sizeClass}`}>
      <span className="pill-dot" />
      {label}
    </span>
  );
}
