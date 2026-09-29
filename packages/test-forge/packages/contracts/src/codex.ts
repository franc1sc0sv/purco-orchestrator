import type { Scope } from "./project.ts";

export const SEVERITIES = ["blocking", "advisory"] as const;

export type Severity = (typeof SEVERITIES)[number];

export const MECHANIZATIONS = ["full", "partial", "judgment"] as const;

export type Mechanization = (typeof MECHANIZATIONS)[number];

export const VERDICT_SPACE = ["pass", "violation", "not-applicable"] as const;

export type Verdict = (typeof VERDICT_SPACE)[number];

export const CHECK_KINDS = [
  "grep",
  "ast-grep",
  "script",
  "sql",
  "none",
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export const CHECK_EXPECTATIONS = [
  "match",
  "no-match",
  "exit-zero",
  "exit-nonzero",
] as const;

export type CheckExpectation = (typeof CHECK_EXPECTATIONS)[number];

export type StoredCheck = {
  kind: CheckKind;
  pattern?: string;
  language?: string;
  include?: string[];
  exclude?: string[];
  script?: string;
  args?: string[];
  expect?: CheckExpectation;
  note?: string;
};

export type CheckExpression = string | StoredCheck | null;

export type ProcedurePaths = {
  include: string[];
  exclude: string[];
};

export type Procedure = {
  human: string;
  check: CheckExpression;
  paths?: ProcedurePaths;
};

export type RubricItem = {
  id?: string;
  question: string;
  expects: string;
  weight?: number;
};

export const FIXTURE_LABELS = [
  "follows",
  "violates",
  "not-applicable",
] as const;

export type FixtureLabel = (typeof FIXTURE_LABELS)[number];

export type Fixture = {
  path: string;
  hash?: string;
  label: FixtureLabel;
  isNearMiss?: boolean;
  why: string;
  labelledBy: string;
  createdAt?: string;
};

export type ReviewerScore = {
  passed: number;
  total: number;
};

export type Acceptance = {
  fixtures: number;
  nearMisses: number;
  reviewerScore: ReviewerScore;
  acceptedAt: string;
};

export type Citation = {
  path: string;
  line?: number;
  excerpt?: string;
  note?: string;
};

export type CorpusSample = {
  scanned: number;
  followed: number;
  violated: number;
  notApplicable?: number;
  sampledAt?: string;
};

export type Evidence = {
  follows: Citation[];
  violates: Citation[];
  corpus: CorpusSample | null;
};

export type Retirement = {
  at: string;
  reason: string;
};

export type Rule = {
  id: string;
  version?: number;
  aspect: string;
  scope: Scope;
  severity: Severity;
  mechanization: Mechanization;
  statement: string;
  rationale: string;
  archaeology: string;
  appliesWhen: Procedure;
  detect: Procedure;
  violates: Procedure;
  rubric: RubricItem[];
  verdictSpace: Verdict[];
  fixtures: Fixture[];
  acceptance?: Acceptance;
  evidence: Evidence;
  decidedBy: string;
  retired?: Retirement;
};

export type RuleVersion = {
  id: string;
  version: number;
  aspect: string;
  scope: Scope;
  severity: Severity;
  mechanization: Mechanization;
  statement: string;
  rationale: string;
  archaeology: string;
  appliesWhen: Procedure;
  detect: Procedure;
  violates: Procedure;
  rubric: RubricItem[];
  verdictSpace: Verdict[];
  evidence: Evidence;
  decidedBy: string;
  createdAt: string;
  retired: Retirement | null;
  fixtures: Fixture[];
  acceptance: Acceptance | null;
};
