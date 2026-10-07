import type { ResolutionState } from "test-forge-contracts/closure";
import type {
  Acceptance,
  Fixture,
  FixtureLabel,
} from "test-forge-contracts/codex";
import type { Mechanization, Severity } from "test-forge-contracts/codex";
import type {
  EscalationResolution,
  EscalationState,
  EscalationSubjectKind,
} from "test-forge-contracts/escalation";
import type { ExitKind } from "test-forge-contracts/gates";
import type {
  EquivalenceClaim,
  Mutant,
  MutantOutcome,
  MutationOperator,
} from "test-forge-contracts/mutation";
import type { Project, Scope } from "test-forge-contracts/project";

export type SchemaMetaRow = {
  key: string;
  value: string;
  updated_at: string;
};

export type ProjectRow = {
  project_key: string;
  short_name: string;
  remote_url: string | null;
  root_path: string;
  scopes_in_use: string;
  created_at: string;
};

export type CodexVersionRow = {
  id: number;
  project_key: string;
  scope: Scope;
  aspect: string;
  rule_id: string;
  version: number;
  severity: Severity;
  mechanization: Mechanization;
  statement: string;
  rationale: string;
  archaeology: string;
  applies_when_json: string;
  detect_json: string;
  violates_json: string;
  rubric_json: string;
  verdict_space_json: string;
  evidence_json: string;
  decided_by: string;
  created_at: string;
  superseded_by: number | null;
  retired_at: string | null;
  retired_reason: string | null;
};

export type CodexCurrentRow = CodexVersionRow;

export type TaxonomyExtRow = {
  project_key: string;
  scope: Scope;
  aspect: string;
  applies_when: string;
  blocking_bar: string;
  created_at: string;
};

export type FixtureRow = {
  id: number;
  project_key: string;
  rule_id: string;
  file_path: string;
  file_hash: string;
  label: FixtureLabel;
  is_near_miss: number;
  why: string;
  labelled_by: string;
  created_at: string;
};

export type AcceptanceRow = {
  id: number;
  project_key: string;
  rule_id: string;
  rule_version: number;
  fixture_count: number;
  near_miss_count: number;
  score_passed: number;
  score_total: number;
  accepted_at: string;
};

export type RunRow = {
  id: number;
  project_key: string;
  focus: string;
  scope: Scope;
  started_at: string;
  ended_at: string | null;
  exit_kind: ExitKind | null;
  exit_reason: string | null;
};

export type PassRow = {
  id: number;
  run_id: number;
  pass_no: number;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
  d5: number;
  d6: number;
  d7: number;
  d8: number;
  d9: number;
  d10: number;
  created_at: string;
};

export type EscalationRow = {
  id: number;
  project_key: string;
  run_id: number;
  escalation_key: string;
  raised_by: string;
  post: string;
  subject_kind: EscalationSubjectKind;
  subject_ref: string;
  claim: string;
  evidence: string;
  state: EscalationState;
  resolution: EscalationResolution | null;
  resolved_by: string | null;
  resolved_reason: string | null;
  resolved_at: string | null;
  created_at: string;
};


export type UnitState =
  | "assigned"
  | "drafted"
  | "reviewed"
  | "revised"
  | "accepted"
  | "abandoned";

export type UnitRow = {
  id: number;
  run_id: number;
  project_key: string;
  file_path: string;
  author_callsign: string;
  state: UnitState;
};

export type FindingStatus =
  | "open"
  | "fixed"
  | "waived"
  | "confirmed-defect"
  | "confirmed-but-known"
  | "rejected"
  | "superseded";

export type FindingRow = {
  id: number;
  project_key: string;
  run_id: number;
  finding_key: string;
  severity: Severity;
  title: string;
  location: string;
  evidence: string;
  proposed_fix: string;
  status: FindingStatus;
  created_at: string;
};

export type SubjectKind =
  | "file"
  | "test"
  | "finding"
  | "mutant"
  | "matrix-cell"
  | "radius-node"
  | "focus-item";

export type RecordedVerdict =
  | "pass"
  | "violation"
  | "not-applicable"
  | "confirmed-defect"
  | "confirmed-but-known"
  | "not-a-defect";

export type VerdictRow = {
  id: number;
  run_id: number;
  project_key: string;
  subject_kind: SubjectKind;
  subject_ref: string;
  agent_callsign: string;
  post: string;
  rule_id: string | null;
  verdict: RecordedVerdict;
  rubric_json: string;
  sites_json: string;
  created_at: string;
};

export type OverturnRow = {
  id: number;
  project_key: string;
  verdict_id: number;
  overturned_by: string;
  correct_verdict: string;
  reason: string;
  created_at: string;
};

export type WaiverKind =
  | "matrix-cell"
  | "radius-node"
  | "focus-line"
  | "rule"
  | "mutant"
  | "finding"
  | "test-value";

export type WaiverRow = {
  id: number;
  project_key: string;
  run_id: number;
  kind: WaiverKind;
  ref: string;
  reason: string;
  signed_by: string;
  created_at: string;
};

export type MutantRow = {
  id: number;
  project_key: string;
  run_id: number;
  file_path: string;
  line: number;
  operator: MutationOperator;
  before_text: string;
  after_text: string;
  outcome: MutantOutcome;
};

export type KillRow = {
  id: number;
  mutant_id: number;
  test_name: string;
  file_path: string;
  attribution_complete: number;
};

export type EquivalenceClaimRow = {
  id: number;
  mutant_id: number;
  claimed_by: string;
  argument: string;
  refuted_by: string | null;
  refutation: string | null;
  upheld: number | null;
  signed_by: string | null;
  created_at: string;
};

export type CoverageCellState =
  | "empty"
  | "covered"
  | "waived"
  | "not-applicable";

export type CoverageCellRow = {
  id: number;
  project_key: string;
  run_id: number;
  matrix_key: string;
  row_key: string;
  column_key: string;
  state: CoverageCellState;
  test_ref: string | null;
};

export type RadiusNodeRow = {
  id: number;
  project_key: string;
  run_id: number;
  node_ref: string;
  node_kind: string;
  resolution: ResolutionState;
  cited_test: string | null;
  verified_by: string | null;
};

export type FocusResolution = "unmapped" | "mapped" | "waived";

export type FocusItemRow = {
  id: number;
  project_key: string;
  run_id: number;
  line_no: number;
  text: string;
  resolution: FocusResolution;
  test_ref: string | null;
};

const toBoolean = (value: number): boolean => value === 1;

const toNullableBoolean = (value: number | null): boolean | null =>
  value === null ? null : toBoolean(value);

export const toProject = (row: ProjectRow): Project => ({
  projectKey: row.project_key,
  shortName: row.short_name,
  rootPath: row.root_path,
});

export const toFixture = (row: FixtureRow): Fixture => ({
  path: row.file_path,
  hash: row.file_hash,
  label: row.label,
  isNearMiss: toBoolean(row.is_near_miss),
  why: row.why,
  labelledBy: row.labelled_by,
  createdAt: row.created_at,
});

export const toAcceptance = (row: AcceptanceRow): Acceptance => ({
  fixtures: row.fixture_count,
  nearMisses: row.near_miss_count,
  reviewerScore: { passed: row.score_passed, total: row.score_total },
  acceptedAt: row.accepted_at,
});

export const toMutant = (row: MutantRow): Mutant => ({
  id: row.id,
  file: row.file_path,
  line: row.line,
  operator: row.operator,
  before: row.before_text,
  after: row.after_text,
});

export const toEquivalenceClaim = (
  row: EquivalenceClaimRow
): EquivalenceClaim => ({
  id: row.id,
  mutantId: row.mutant_id,
  claimedBy: row.claimed_by,
  argument: row.argument,
  refutedBy: row.refuted_by,
  refutation: row.refutation,
  upheld: toNullableBoolean(row.upheld),
  signedBy: row.signed_by,
  createdAt: row.created_at,
});
