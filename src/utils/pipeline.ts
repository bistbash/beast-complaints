/**
 * The inquiry lifecycle as a linear pipeline. This is the backbone of the UI:
 * every card, the detail header, and the stats funnel render against these stages.
 *
 *   לקוח מגיש  →  ניתוב לגורם  →  תגובת הגורם  →  התייחסות מד"ר  →  נשלח ללקוח
 *
 * Each stage maps onto the inquiry status machine (new → routed →
 * awaiting_manager → closed) but is expressed in terms of *milestones the
 * inquiry has passed*, which reads far more naturally to a human.
 */

export type StageKey = 'received' | 'routed' | 'team' | 'manager' | 'sent';
export type StageState = 'done' | 'current' | 'upcoming';

/** Each stage carries its own accent so the whole app stays colour-coded by phase. */
export type StageColor = 'slate' | 'indigo' | 'violet' | 'amber' | 'emerald';

export interface PipelineStageDef {
  key: StageKey;
  /** Short label for compact trackers / chips. */
  label: string;
  /** Full title for the detail stepper. */
  title: string;
  /** Who acts in this stage — the human story of the step. */
  actor: string;
  color: StageColor;
}

export const PIPELINE_STAGES: PipelineStageDef[] = [
  { key: 'received', label: 'התקבלה', title: 'הפנייה התקבלה', actor: 'הלקוח הגיש פנייה', color: 'slate' },
  { key: 'routed', label: 'נותבה', title: 'נותבה לגורם מטפל', actor: 'האחראי ניתב לגורם הרלוונטי', color: 'indigo' },
  { key: 'team', label: 'תגובת הגורם', title: 'תגובת הגורם המטפל', actor: 'הגורם המטפל כתב תגובה', color: 'violet' },
  { key: 'manager', label: 'התייחסות מד"ר', title: 'התייחסות המד"ר', actor: 'המד"ר רשם התייחסות סופית', color: 'amber' },
  { key: 'sent', label: 'נשלחה ללקוח', title: 'נשלחה ללקוח', actor: 'התשובה נשלחה ללקוח במייל', color: 'emerald' },
];

export interface PipelineInput {
  status: string;
  routed_at?: string | null;
  assigned_group?: string | null;
  team_response?: string | null;
  team_response_at?: string | null;
  manager_response?: string | null;
  manager_response_at?: string | null;
  closing_email_sent_at?: string | null;
  closed_at?: string | null;
}

export interface PipelineStage {
  def: PipelineStageDef;
  state: StageState;
}

export interface PipelineResult {
  stages: PipelineStage[];
  /** Index of the current (or final, when complete) stage. */
  currentIndex: number;
  current: PipelineStageDef;
  doneCount: number;
  isComplete: boolean;
}

/**
 * Resolve the pipeline state for an inquiry. Works from `status` alone (list
 * cards) and grows more precise when lifecycle timestamps are supplied
 * (detail page) — e.g. a closed-but-unsent inquiry surfaces the email step as
 * still "current".
 */
export function computePipeline(input: PipelineInput): PipelineResult {
  const s = input.status;
  const hasTimestamps = input.closing_email_sent_at !== undefined;

  const done: boolean[] = [
    // received — always true once the row exists.
    true,
    // routed
    !!input.routed_at || !!input.assigned_group || ['routed', 'awaiting_manager', 'closed'].includes(s),
    // team responded
    !!input.team_response_at || !!input.team_response || ['awaiting_manager', 'closed'].includes(s),
    // manager responded
    !!input.manager_response_at || !!input.manager_response || s === 'closed',
    // sent to customer — when we know the email timestamp, trust it; otherwise
    // treat "closed" as sent (the closing action sends the mail).
    hasTimestamps ? !!input.closing_email_sent_at : s === 'closed',
  ];

  let currentIndex = done.findIndex((d) => !d);
  const isComplete = currentIndex === -1;
  if (isComplete) currentIndex = PIPELINE_STAGES.length - 1;

  const stages: PipelineStage[] = PIPELINE_STAGES.map((def, i) => ({
    def,
    state: done[i] ? 'done' : i === currentIndex ? 'current' : 'upcoming',
  }));

  return {
    stages,
    currentIndex,
    current: PIPELINE_STAGES[currentIndex],
    doneCount: done.filter(Boolean).length,
    isComplete,
  };
}
