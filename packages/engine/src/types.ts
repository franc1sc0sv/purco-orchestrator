export const PHASES = [
  "intake",
  "grill",
  "plan",
  "build",
  "static",
  "test",
  "verify",
  "record",
  "review",
  "survey",
  "audit",
  "synthesize",
] as const;

export type Phase = (typeof PHASES)[number];

export const STAGES = [
  "plan",
  "implementation",
  "testing",
  "verification",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_OF_PHASE: Partial<Record<Phase, Stage>> = {
  intake: "plan",
  grill: "plan",
  plan: "plan",
  build: "implementation",
  static: "implementation",
  test: "testing",
  verify: "verification",
  record: "verification",
  review: "verification",
};

export const stageOfKey = (key: string): Stage | undefined => {
  const phase = key.split(/[:#]/)[0] ?? "";
  return STAGE_OF_PHASE[phase as Phase];
};

export const STEP_STATUSES = [
  "pending",
  "running",
  "waiting",
  "halted",
  "done",
  "failed",
  "skipped",
] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

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

export const ROLES = [
  "intake",
  "inquisitor",
  "planner",
  "builder",
  "fixer",
  "tester",
  "verifier",
  "reviewer",
  "surveyor",
  "checker",
  "synthesist",
  "mapper",
  "test-author",
  "inspector",
  "defect-verifier",
  "defect-skeptic",
  "survivor-analyst",
  "equivalence-hunter",
] as const;

export const FORGE_ROLES = [
  "mapper",
  "test-author",
  "inspector",
  "defect-verifier",
  "defect-skeptic",
  "survivor-analyst",
  "equivalence-hunter",
] as const satisfies readonly RoleName[];

export type ForgeRole = (typeof FORGE_ROLES)[number];

export type RoleName = (typeof ROLES)[number];

export const PHASE_ROLE: Record<Phase, RoleName> = {
  intake: "intake",
  grill: "inquisitor",
  plan: "planner",
  build: "builder",
  test: "tester",
  verify: "verifier",
  record: "verifier",
  static: "fixer",
  review: "reviewer",
  survey: "surveyor",
  audit: "checker",
  synthesize: "synthesist",
};

export const JUDGING_PHASES: Phase[] = ["test", "verify", "review", "audit"];

export const SPIKE_PHASES: Phase[] = ["survey", "audit", "synthesize"];

export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
} as const;

export type EscalationLevel =
  "retry" | "repair" | "orchestrator" | "human" | "abort";

export const ESCALATION_ORDER: EscalationLevel[] = [
  "retry",
  "repair",
  "orchestrator",
  "human",
  "abort",
];

export type EventKind =
  | "run_start"
  | "run_end"
  | "phase_start"
  | "phase_end"
  | "spawn"
  | "thinking"
  | "text"
  | "tool_use"
  | "tool_result"
  | "tool_error"
  | "note"
  | "question"
  | "answer"
  | "escalation"
  | "resolution"
  | "message"
  | "handoff"
  | "permission_denied"
  | "mutant"
  | "mutant_plan"
  | "forge_job"
  | "cost";

export type ScratchpadEvent = {
  seq: number;
  at: string;
  runId: string;
  ticket: string;
  agent: string;
  phase: Phase | "run";
  kind: EventKind;
  summary: string;
  data?: Record<string, unknown>;
};

export type Escalation = {
  id: string;
  at: string;
  from: string;
  phase: Phase | "run";
  level: EscalationLevel;
  summary: string;
  detail?: string;
  blocker?: string;
  attempts: number;
  resolvedAt?: string;
  resolution?: string;
  resolvedBy?: "agent" | "orchestrator" | "human" | "policy";
};

export type BusMessage = {
  id: string;
  at: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  readAt?: string;
};

export type PhaseTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export type PhaseOutcome = {
  phase: Phase;
  agent: string;
  status: "done" | "failed" | "escalated" | "skipped";
  summary: string;
  outputPath?: string;
  sessionId?: string;
  costUsd: number;
  turns: number;
  tokens: PhaseTokens;
  model?: string;
  escalations: string[];
  errors: string[];
  result?: StepResult;
  halt?: string;
};

export type RunConfig = {
  workflow: "ticket" | "spike" | "test";
  ticket: string;
  worktree: string;
  contextPack: string;
  runDir: string;
  runId: string;
  phases: Phase[];
  modelOverride?: string;
  maxTurnsPerPhase: number;
  resume: boolean;
  autoApproveWrites: boolean;
  nonInteractive: boolean;
  askHuman: boolean;
  configDir?: string;
  mailboxDb?: string;
  testTargets?: string;
  testFocus?: string;
  testScope?: "backend" | "frontend";
  testDepth: "full" | "quick";
  testMode?: "write" | "harden";
  testStrict?: boolean;
  testDepthExplicit: boolean;
};

export const SITE_AXES = ["A", "B", "C", "D", "E"] as const;

export type SiteAxis = (typeof SITE_AXES)[number];

export type SiteState =
  "untriaged" | "no_change" | "leftover" | "defect" | "keeps_account";

export type Site = {
  id?: number;
  path: string;
  axis: SiteAxis;
  touchesBa: boolean;
  touchesIp: boolean;
  hasFlag: boolean;
  isWriter: boolean;
  cluster?: string;
  state?: SiteState;
  hits?: number;
  reachedVia?: string;
};

export type FindingOperation = "read" | "create" | "edit" | "delete";

export type FindingSeverity = "data_loss" | "wrong_display" | "cosmetic";

export type FindingStatus = "found" | "verified" | "rejected" | "needs_human";

export type Finding = {
  id: string;
  siteId?: number;
  operation: FindingOperation;
  claim: string;
  behaviorFlagOn?: string;
  behaviorFlagOff?: string;
  targetState?: string;
  severity: FindingSeverity;
  status: FindingStatus;
  verdict?: string;
  evidence?: string;
  foundBy?: string;
  verifiedBy?: string;
};

export type StoredPhase = {
  phase: string;
  agent?: string;
  status: string;
  summary?: string;
  costUsd: number;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model?: string;
  startedAt?: string;
  endedAt?: string;
};

export const OUTCOME_KINDS = [
  "delivered",
  "blocked",
  "disputed",
  "failed",
] as const;

export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export type ResultFinding = {
  title: string;
  severity: string;
  location: string;
};

export const TICKET_KINDS = ["feature", "bugfix", "performance", "ui", "data", "chore"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export type Story = {
  line: string;
  example?: { input: string; result: string };
  labels?: Record<string, string>;
  before?: string;
  after?: string;
  metrics?: { name: string; before: number; after: number; unit?: string }[];
};

export type ChangedFile = { path: string; added: number; deleted: number; isNew: boolean };

export type ChangedTable = {
  name: string;
  isNew: boolean;
  columns: string[];
  references: string[];
  migration: string;
};

export type ChangeSnapshot = { files: ChangedFile[]; tables: ChangedTable[] };

export type StepResult = {
  status: OutcomeKind;
  summary: string;
  outputPath?: string;
  produced: string[];
  openQuestions: number;
  evidence?: string;
  counts?: Record<string, number>;
  findings?: ResultFinding[];
  kind?: TicketKind;
  story?: Story;
  appliedNotes?: AppliedNote[];
};

export type AppliedNote = { id: number; reply: string };

export const NOTE_STATUSES = ["queued", "seen", "applied"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export type NoteVia = "dashboard" | "cli";

export type StoredNote = {
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
  via: NoteVia;
};

export type NewNote = {
  targetAgent?: string;
  file?: string;
  line?: number;
  text: string;
  via: NoteVia;
};

export type HumanItemKind = "question" | "gate" | "sign";

export type StoredQuestion = {
  id: string;
  fromAgent: string;
  phase: string;
  level: HumanItemKind | string;
  question: string;
  answer?: string;
  answeredBy?: string;
  at: string;
};
