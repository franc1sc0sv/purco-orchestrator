export const PHASES = [
  "intake",
  "grill",
  "plan",
  "build",
  "test",
  "verify",
  "static",
  "review",
  "survey",
  "audit",
  "synthesize",
] as const;

export type Phase = (typeof PHASES)[number];

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
] as const;

export type RoleName = (typeof ROLES)[number];

export const PHASE_ROLE: Record<Phase, RoleName> = {
  intake: "intake",
  grill: "inquisitor",
  plan: "planner",
  build: "builder",
  test: "tester",
  verify: "verifier",
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
  budgetUsd?: number;
  resume: boolean;
  autoApproveWrites: boolean;
  nonInteractive: boolean;
  askHuman: boolean;
  configDir: string;
  mailboxDb?: string;
  testTargets?: string;
  testFocus?: string;
  testScope?: "backend" | "frontend";
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
