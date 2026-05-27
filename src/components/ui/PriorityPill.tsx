import React from 'react';
import { PRIORITY_META, type InquiryPriority } from '../../utils/constants.ts';

interface PriorityPillProps {
  priority: InquiryPriority | string;
  size?: 'sm' | 'md';
}

const TONE_CLASS: Record<string, string> = {
  neutral:
    'bg-neutral-50 text-neutral-700 border-neutral-200 dark:bg-neutral-800/60 dark:text-neutral-200 dark:border-neutral-700',
  info:
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900',
  warning:
    'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  danger:
    'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
};

export default function PriorityPill({ priority, size = 'md' }: PriorityPillProps) {
  const meta = PRIORITY_META[priority as InquiryPriority];
  const label = meta?.label || String(priority);
  const tone = meta?.tone || 'neutral';
  const sizeClass = size === 'sm' ? 'text-[10.5px] px-2 py-0.5' : '';
  return <span className={`pill ${TONE_CLASS[tone]} ${sizeClass}`}>{label}</span>;
}
