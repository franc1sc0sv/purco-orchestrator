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
  awaitingGrill: { id: number; question: string } | null;
  recorded: boolean;
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
  id: number;
  workerId: string;
  at: string;
  tokens: number;
  costUsd: number;
};

export type GrillOption = { label: string; consequence?: string; example?: string };

export type GrillDiagramMode = "now" | "changed" | "new";

export type GrillDiagram = {
  nodes: { id: string; label: string; sub?: string; mode: GrillDiagramMode }[];
  edges: { from: string; to: string; label?: string }[];
};

export type GrillStatus = "open" | "upcoming" | "answered" | "parked" | "settled" | "assumed";

export type GrillQuestion = {
  id: number;
  question: string;
  whyOpen?: string;
  evidence?: string;
  explain?: string;
  example?: string;
  diagram?: GrillDiagram;
  options: GrillOption[];
  dependsOn: number[];
  recommended?: string;
  blocking: boolean;
  status: GrillStatus;
  itemId: string | null;
  answer: string | null;
  answeredVia: "dashboard" | "cli" | null;
  early: boolean;
};

export type GrillView = { questions: GrillQuestion[] };

export type MutantEvent = {
  id: number;
  file: string;
  line: number;
  before: string;
  after: string;
  mutator?: string;
  status:
    | "killed"
    | "survived"
    | "equivalent"
    | "error"
    | "no_coverage"
    | "timeout_pending"
    | "killed_by_timeout"
    | "out_of_scope"
    | "unviable";
  ms: number;
  tests?: string[];
};

export type PlannedMutant = {
  id: number;
  file: string;
  line: number;
  before: string;
  after: string;
  mutator?: string;
};

export type GateMark = { id: string; pass: boolean };

export type TestsView = {
  planned: PlannedMutant[];
  mutants: MutantEvent[];
  gates: GateMark[];
  activity: { at: string; text: string } | null;
};

export type StreamEvent = {
  seq: number;
  at: string;
  agent: string;
  stage: Stage | null;
  kind: string;
  tool?: string;
  cmd?: string;
  toolUseId?: string;
  why?: string;
  ms?: number;
  ok?: boolean;
  text?: string;
  mutant?: MutantEvent;
};

export type TicketParts = {
  summary: TicketSummary;
  pipeline: PipelineStage[];
  workers: Worker[];
  liveWorkerIds: string[];
  cost: CostRollup;
  alerts: Alert[];
  decisions: Decision[];
  items: OpenItem[];
  grill: GrillView;
  tests: TestsView;
};

export type TicketDetail = TicketParts & {
  samples: Sample[];
  events: StreamEvent[];
  generatedAt: string;
};

export type TicketDelta = Partial<TicketParts> & {
  samples: Sample[];
  events: StreamEvent[];
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

export const isGrillItem = (item: OpenItem): boolean =>
  typeof item.payload === "object" &&
  item.payload !== null &&
  "grill" in item.payload &&
  item.payload.grill === true;

export type FailureKind = { id: string; label: string };

export type FailureMapStep = {
  key: string;
  baseKey: string;
  stage: Stage;
  status: StepStatus;
  tries: number;
};

export type FailureMove = { label: string; detail: string; bad: boolean };

export type FailureGroup = {
  key: string;
  kind: FailureKind;
  stepKind: string;
  title: string;
  steps: string[];
  tries: number;
  expected: string | null;
  got: string | null;
  said: string | null;
  fixedIn: string | null;
  worker: string | null;
  lastMoves: FailureMove[];
};

export type FailuresView = {
  map: FailureMapStep[];
  groups: FailureGroup[];
  resume: { step: string; command: string } | null;
  costUsd: number;
  failedSteps: number;
  kinds: (FailureKind & { count: number })[];
};

export const TICKET_KINDS = ["feature", "bugfix", "performance", "ui", "data", "chore"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export type StoryFile = { path: string; added: number; deleted: number; isNew: boolean };

export type StoryLayer = { layer: string; added: number; deleted: number; files: StoryFile[] };

export type StoryTable = { name: string; isNew: boolean; columns: string[]; references: string[]; migration: string };

export type StoryText = {
  line: string;
  example?: { input: string; result: string };
  labels?: Record<string, string>;
  before?: string;
  after?: string;
  metrics?: { name: string; before: number; after: number; unit?: string }[];
};

export type StoryView = {
  kind?: TicketKind;
  story?: StoryText;
  layers: StoryLayer[];
  edges: { from: string; to: string; label?: string }[];
  tables: StoryTable[];
};

export const NOTE_STATUSES = ["queued", "seen", "applied"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export type Note = {
  id: number;
  ticket: string;
  targetAgent?: string;
  file?: string;
  line?: number;
  text: string;
  status: NoteStatus;
  reply?: string;
  createdAt: string;
  seenAt?: string;
  appliedAt?: string;
  via: "dashboard" | "cli";
};

export type NewNote = { text: string; file?: string; line?: number; targetAgent?: string };

export type FileEntry = {
  path: string;
  layer: string;
  added: number;
  removed: number;
  isNew: boolean;
  version: number;
  agent?: string;
  at?: string;
};

export type FilesView = { files: FileEntry[] };

export type FileDiff = { path: string; isNew: boolean; diff: string };
