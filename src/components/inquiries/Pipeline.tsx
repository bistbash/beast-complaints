import { computePipeline, PIPELINE_STAGES, type PipelineInput, type PipelineResult } from '../../utils/pipeline.ts';

function resolve(input: PipelineInput | PipelineResult): PipelineResult {
  return 'stages' in input ? input : computePipeline(input);
}

/** Thin connected tracker for list cards — five segments coloured by phase. */
export function CompactPipeline({ value }: { value: PipelineInput | PipelineResult }) {
  const pipe = resolve(value);
  return (
    <div className="pipe-compact" role="img" aria-label={`שלב נוכחי: ${pipe.current.label}`}>
      {pipe.stages.map((s) => (
        <span key={s.def.key} className="stage pipe-seg" data-color={s.def.color} data-state={s.state} />
      ))}
    </div>
  );
}

/** A single colour-coded "where it is now" badge. */
export function StageChip({ value }: { value: PipelineInput | PipelineResult }) {
  const pipe = resolve(value);
  const def = pipe.isComplete ? PIPELINE_STAGES[PIPELINE_STAGES.length - 1] : pipe.current;
  const label = pipe.isComplete ? 'הטיפול הושלם' : def.label;
  return (
    <span className="stage stage-chip" data-color={def.color}>
      <span className="pill-dot" />
      {label}
    </span>
  );
}

/** Horizontal key that teaches the stage colour-code. Used on list/dashboard headers. */
export function PipelineLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`}>
      {PIPELINE_STAGES.map((def, i) => (
        <span key={def.key} className="stage flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400" data-color={def.color}>
          <span className="h-2 w-2 rounded-full" style={{ background: 'rgb(var(--stage) / 1)' }} />
          <span>{def.label}</span>
          {i < PIPELINE_STAGES.length - 1 && <span className="text-neutral-300 dark:text-neutral-600">←</span>}
        </span>
      ))}
    </div>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Full, labelled stepper — the hero of the inquiry detail page. */
export function FullPipeline({ value }: { value: PipelineInput | PipelineResult }) {
  const pipe = resolve(value);
  return (
    <ol className="stepper">
      {pipe.stages.map((s, i) => {
        const reached = s.state === 'done' || s.state === 'current';
        return (
          <li
            key={s.def.key}
            className="stage stepper-node"
            data-color={s.def.color}
            data-state={s.state}
            data-line={reached ? 'filled' : 'empty'}
          >
            <span className="stepper-dot">
              {s.state === 'done' ? <Check /> : <span className="text-sm font-bold tabular-nums">{i + 1}</span>}
            </span>
            <span className="stepper-label">{s.def.title}</span>
            <span className="stepper-actor">{s.def.actor}</span>
          </li>
        );
      })}
    </ol>
  );
}
