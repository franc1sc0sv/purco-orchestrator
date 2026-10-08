import type { Kill, MutantOutcome } from "./mutation.ts";

export const PROJECT_KINDS = ["backend", "frontend"] as const;

export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const SCOPE_RULES = ["start-line", "span-overlap"] as const;

export type ScopeRule = (typeof SCOPE_RULES)[number];

export type SourcePosition = {
  line: number;
  column: number;
};

export type MutantSite = {
  file: string;
  mutator: string;
  replacement: string;
  start: SourcePosition;
  end: SourcePosition;
};

export type LineRange = readonly [number, number];

export type ChangedLines = Record<string, LineRange[]>;

export type InstrumentFailure = {
  file: string;
  error: string;
};

export type ScopeSelection = {
  kind: ProjectKind;
  files: string[];
  testFiles: string[];
  inScope: MutantSite[];
  overlapOnly: MutantSite[];
  uncovered: MutantSite[];
};

export type HarnessState = {
  worktree: string;
  pid: number;
  concurrency: number;
  templates: string[];
  manifestPath: string;
  stopFilePath: string;
  bootLogPath: string;
  containerIds: string[];
  startedAt: string;
};

export type HarnessStartResult =
  | {
      ok: true;
      reused: boolean;
      state: HarnessState;
      bootMs: number;
      warnings: string[];
    }
  | { ok: false; reason: string; bootLogTail: string | null };

export type HarnessStatusResult = {
  running: boolean;
  manifestReady: boolean;
  state: HarnessState | null;
  liveContainerIds: string[];
};

export type HarnessStopResult = {
  ok: boolean;
  teardownClean: boolean;
  killed: boolean;
  removedContainerIds: string[];
  leftoverContainerIds: string[];
};

export type StrykerCounts = Partial<Record<MutantOutcome, number>>;

export type StrykerKindRun = {
  kind: ProjectKind;
  ranMutants: number;
  inScope: number;
  outOfScope: number;
  uncovered: number;
  testFiles: string[];
  counts: StrykerCounts;
  reportPath: string | null;
  eventsPath: string | null;
  dryRunMs: number | null;
  mutationMs: number | null;
  totalMs: number;
  logTail: string;
};

export type StrykerDurations = {
  selectionMs: number;
  strykerMs: number;
  ledgerMs: number;
  totalMs: number;
};

export type StrykerRunResult =
  | {
      ok: true;
      runId: number | null;
      baseRef: string;
      mergeBase: string;
      scopeRule: ScopeRule;
      inScope: number;
      outOfScope: number;
      overlapOnly: number;
      uncovered: number;
      instrumentFailures: InstrumentFailure[];
      counts: StrykerCounts;
      durations: StrykerDurations;
      reportPath: string | null;
      runs: StrykerKindRun[];
      ledgerRows: number;
    }
  | { ok: false; reason: string };

export type StrykerScopeResult =
  | {
      ok: true;
      baseRef: string;
      mergeBase: string;
      scopeRule: ScopeRule;
      selections: ScopeSelection[];
      inScope: number;
      overlapOnly: number;
      instrumentFailures: InstrumentFailure[];
      selectionMs: number;
    }
  | { ok: false; reason: string };

export const EXTRA_MUTATORS = [
  "ExtraJsxBooleanAttribute",
  "ExtraLogicalOperand",
  "ExtraNumberLiteral",
] as const;

export type ExtraMutator = (typeof EXTRA_MUTATORS)[number];

export type SoloMutantResult = {
  mutantId: number;
  file: string;
  line: number;
  mutator: string;
  replacement: string;
  outcome: MutantOutcome;
  strykerStatus: string;
  killedBy: Kill[];
  testFiles: string[];
  baselineMs: number | null;
  limitMs: number | null;
  durationMs: number;
  reason: string | null;
};

export type SoloRunSummary = {
  checked: number;
  counts: StrykerCounts;
  results: SoloMutantResult[];
  recoveredBackups: string[];
  durationMs: number;
};

export type TimeoutRecheckResult =
  | ({ ok: true; runId: number } & SoloRunSummary)
  | { ok: false; reason: string };

export type ExtraOperatorsResult =
  | ({
      ok: true;
      runId: number;
      scopeRule: ScopeRule;
      generated: number;
      duplicatesOfStryker: number;
      noCoverage: number;
      byMutator: Record<string, number>;
      generateMs: number;
    } & SoloRunSummary)
  | { ok: false; reason: string };

export type UnresolvedMutant = {
  mutantId: number;
  file: string;
  line: number;
  mutator: string;
  outcome: MutantOutcome;
};

export type Reconciliation = {
  changedFiles: number;
  changedLines: number;
  inScopeStryker: number;
  inScopeExtra: number;
  inScopeExpected: number;
  inScopeInLedger: number;
  finalStates: StrykerCounts;
  withoutFinalState: UnresolvedMutant[];
  consistent: boolean;
};

export type MutationPassStage = {
  stage: string;
  ms: number;
};

export type MutationPassResult =
  | {
      ok: true;
      runId: number;
      scopeRule: ScopeRule;
      harnessStarted: boolean;
      harnessStopped: boolean | null;
      testFiles: Record<ProjectKind, string[]>;
      counts: StrykerCounts;
      stryker: Extract<StrykerRunResult, { ok: true }>;
      extras: Extract<ExtraOperatorsResult, { ok: true }>;
      timeoutRecheck: Extract<TimeoutRecheckResult, { ok: true }>;
      reconciliation: Reconciliation;
      stages: MutationPassStage[];
      totalMs: number;
    }
  | { ok: false; reason: string; stages: MutationPassStage[] };
