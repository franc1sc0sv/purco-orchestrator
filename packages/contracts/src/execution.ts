export const RUNNER_FAMILIES = [
  "vitest",
  "jest",
  "playwright",
  "mocha",
  "node-test",
  "unknown",
] as const;

export type RunnerFamily = (typeof RUNNER_FAMILIES)[number];

export const SEPARATOR_MODES = ["auto", "always", "never"] as const;

export type SeparatorMode = (typeof SEPARATOR_MODES)[number];

export const LINT_FORMATS = ["auto", "json", "text"] as const;

export type LintFormat = (typeof LINT_FORMATS)[number];

export const REPORT_SOURCES = ["report-file", "stdout"] as const;

export type ReportSource = (typeof REPORT_SOURCES)[number];

export type TestRecord = {
  file: string;
  testName: string;
  status: string;
};

export type FailureRecord = {
  file: string;
  testName: string;
  message: string;
};

export type ParsedRun = {
  passed: number;
  failed: number;
  skipped: number;
  failures: FailureRecord[];
  tests: TestRecord[];
  durationMs: number | null;
};

export type SuiteRun = {
  command: string;
  family: RunnerFamily;
  files: string[];
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  reportParsed: boolean;
  reportSource: ReportSource | null;
  reportError: string | null;
  exitCodeUnexplained: boolean;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  failures: FailureRecord[];
  tests: TestRecord[];
  durationMs: number;
  diagnosticTail: string | null;
};

export type ProbeRun = {
  index: number;
  shuffled: boolean;
  fileOrder: string[];
  nativeShuffleArgs: string[];
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  reportParsed: boolean;
  reportError: string | null;
  exitCode: number | null;
  durationMs: number;
  failures: FailureRecord[];
  testCount: number;
};

export const DIVERGENCE_KINDS = ["presence", "status"] as const;

export type DivergenceKind = (typeof DIVERGENCE_KINDS)[number];

export type Divergence = {
  testKey: string;
  statuses: string[];
  kind: DivergenceKind;
};

export type UnparsedRun = {
  index: number;
  reportError: string | null;
};

export type FlakeReport = {
  stable: boolean;
  seed: number;
  repeats: number;
  family: RunnerFamily;
  nativeShuffleSupported: boolean;
  unparsedRuns: UnparsedRun[];
  countsDiverge: boolean;
  divergences: Divergence[];
  runs: ProbeRun[];
};

export const PROBLEM_SEVERITIES = ["error", "warning"] as const;

export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[number];

export type Problem = {
  file: string | null;
  line: number | null;
  column: number | null;
  severity: ProblemSeverity;
  code: string | null;
  message: string;
};

export type ProblemSummary = {
  errorCount: number;
  warningCount: number;
  problems: Problem[];
  truncated: boolean;
  totalProblems: number;
};

export type StaticCommandReport = ProblemSummary & {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  parsed: boolean;
  diagnosticTail: string | null;
};

export type LintReport = StaticCommandReport & {
  format: "json" | "text";
};

export type StaticGateReport = {
  ok: boolean;
  ran: { typecheck: boolean; lint: boolean };
  typecheck: StaticCommandReport | null;
  lint: LintReport | null;
  totalErrors: number;
  totalWarnings: number;
};
