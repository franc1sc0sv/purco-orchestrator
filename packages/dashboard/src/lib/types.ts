export const STAGES = ["plan", "implementation", "testing", "verification"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  plan: "Plan",
  implementation: "Implementation",
  testing: "Testing",
  verification: "Verification",
};

export const STAGE_SHORT_LABELS: Record<Stage, string> = {
  plan: "Plan",
  implementation: "Impl",
  testing: "Test",
  verification: "Verif",
};

export type StepStatus =
  | "pending"
  | "running"
  | "waiting"
  | "halted"
  | "done"
  | "failed"
  | "skipped";

export type TicketState = "running" | "waiting" | "stuck" | "halted" | "failed" | "done" | "idle";

export type WorkerState =
  | "starting"
  | "thinking"
  | "tool"
  | "waiting-human"
  | "waiting-lead"
  | "done"
  | "failed"
  | "halted";

export type StageSummary = {
  stage: Stage;
  status: StepStatus;
  progress: number;
  done: number;
  total: number;
};

export type TicketSummary = {
  ticket: string;
  size: string | null;
  sizeReason: string | null;
  state: TicketState;
  stages: StageSummary[];
  costUsd: number;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  liveAgents: number;
  openItemCount: number;
  unseenAlerts: Alert[];
  activeRun: string | null;
  heartbeatAgeSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  elapsedMs: number;
  updatedAt: number;
};

export type PipelineStep = {
  key: string;
  baseKey: string;
  attempt: number;
  status: StepStatus;
  reason?: string;
  startedAt?: string;
  endedAt?: string;
};

export type PipelineStage = {
  stage: Stage;
  status: StepStatus;
  steps: PipelineStep[];
};

export type Worker = {
  id: string;
  ticket: string;
  runId: string;
  step: string;
  stage?: Stage;
  label: string;
  role: string;
  model: string;
  state: WorkerState;
  action: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  turns: number;
  maxTurns: number;
  startedAt: string;
  lastEventAt: string;
  endedAt?: string;
  haltReason?: string;
};

export type Totals = {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  turns: number;
  workers: number;
};

export type CostRollup = {
  ticket: Totals;
  stages: Record<Stage, Totals>;
  steps: Record<string, Totals>;
  workers: { id: string; step: string; label: string; role: string; state: WorkerState; costUsd: number }[];
};

export type AlertKind =
  | "gate"
  | "question"
  | "sign"
  | "stuck"
  | "loop"
  | "burn"
  | "halted"
  | "done";

export type Alert = {
  id: number;
  ticket: string;
  runId: string;
  workerId?: string;
  step: string;
  kind: AlertKind;
  message: string;
  title: string;
  at: string;
  seen: number;
};

export type Decision = {
  id: number;
  runId: string;
  step: string;
  kind: string;
  subjects: string[];
  question: string;
  brief: string;
  decision: string;
  text: string;
  at: string;
};

export type Sample = {
  workerId: string;
  at: string;
  tokens: number;
  costUsd: number;
};

export type TicketDetail = {
  summary: TicketSummary;
  pipeline: PipelineStage[];
  workers: Worker[];
  liveWorkerIds: string[];
  cost: CostRollup;
  alerts: Alert[];
  decisions: Decision[];
  items: OpenItem[];
  samples: Sample[];
  generatedAt: string;
};

export type HistoryEntry = {
  ticket: string;
  size: string | null;
  costUsd: number;
  tokens: number;
  durationMs: number;
  stageDurationsMs: Record<Stage, number>;
  endedAt: string | null;
};

export type PlanGateWarningCode =
  | "mapper-no-result"
  | "focus-none"
  | "non-usecase-files"
  | "radius-unresolved-majority";

export type PlanGatePayload = {
  type: "test-plan";
  ticket: string;
  runId: number;
  scope: "backend" | "frontend";
  mode: "write" | "harden";
  depth: "full" | "quick";
  size: string | null;
  contract: string;
  units: {
    file: string;
    rows: number;
    sources: string[];
    focusLines: number[];
    usecaseLevel: boolean;
  }[];
  radius: { total: number; unresolved: number };
  warnings: { code: PlanGateWarningCode; message: string }[];
};

export type OpenItem = {
  id: string;
  kind: "gate" | "question" | "sign" | string;
  text: string;
  from: string;
  at: string;
  payload: unknown;
};

export type UsageTotals = {
  tokens: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  costUsd: number;
  messages: number;
};

export type ModelUsage = { model: string; tokens: number; costUsd: number };

export type DayUsage = { date: string; tokens: number; costUsd: number };

export type UsageBlock = {
  startedAt: string;
  endsAt: string;
  resetsInMs: number;
  elapsedFraction: number;
  totals: UsageTotals;
  burnTokensPerMin: number;
  projectedTokens: number;
  series: { at: string; tokens: number }[];
  models: ModelUsage[];
};

export type LimitWindow = {
  pct: number;
  resetsAt: number;
  at: number;
  source: "statusline" | "engine";
};

export type ModelLimit = LimitWindow & { model: string };

export type PlanLimits = {
  session?: LimitWindow;
  weekly?: LimitWindow;
  weeklyByModel: ModelLimit[];
  installCommand: string;
};

export type UsageSnapshot = {
  ready: boolean;
  generatedAt: string;
  block: UsageBlock | null;
  rolling: UsageTotals;
  calendar: UsageTotals;
  days: DayUsage[];
  models: ModelUsage[];
  limits: PlanLimits;
};
