import { PIPELINE_STAGES } from '../../utils/pipeline.ts';

/** Stage accents as concrete hex so the mark renders identically on any surface. */
const STAGE_HEX: Record<string, string> = {
  slate: '#94a3b8',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  emerald: '#10b981',
};

/**
 * The app's brand mark: the inquiry pipeline distilled into a row of
 * stage-coloured dots. Replaces the generic monogram so the identity carries
 * the same story as the rest of the UI.
 */
export default function BrandMark({ size = 36 }: { size?: number }) {
  const n = PIPELINE_STAGES.length;
  const step = 18 / (n - 1);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl bg-neutral-900 shadow-soft dark:bg-white"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.64}
        height={size * 0.64}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="text-white/25 dark:text-neutral-900/25"
      >
        <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        {PIPELINE_STAGES.map((s, i) => (
          <circle key={s.key} cx={3 + i * step} cy="12" r="1.8" fill={STAGE_HEX[s.color]} />
        ))}
      </svg>
    </div>
  );
}
