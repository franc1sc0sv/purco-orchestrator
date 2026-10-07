import { ATTRIBUTION_INCOMPLETE } from "../mutation/attribution.ts";
import type {
  FailedSubject,
  PredicateKey,
  PredicateResult,
} from "test-forge-contracts/gates";

export const DEFECT_VERDICTS = [
  "confirmed-defect",
  "confirmed-but-known",
] as const;

export type DefectVerdict = (typeof DEFECT_VERDICTS)[number];

export const isDefectVerdict = (value: string): value is DefectVerdict =>
  DEFECT_VERDICTS.includes(value as DefectVerdict);

export const CONFORMANCE_VERDICTS = ["pass", "not-applicable"] as const;

const posix = (value: string | null | undefined): string =>
  (value ?? "").split("\\").join("/");

export const samePath = (
  left: string | null | undefined,
  right: string | null | undefined
): boolean => {
  const a = posix(left).replace(/^\.\//, "");
  const b = posix(right).replace(/^\.\//, "");
  if (a.length === 0 || b.length === 0) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
};

export const splitTestRef = (
  value: string | null | undefined
): { file: string; name: string } => {
  const text = posix(value).trim();
  const marker = text.includes(" :: ")
    ? " :: "
    : text.includes("::")
    ? "::"
    : null;
  if (marker === null) return { file: "", name: text };
  const index = text.indexOf(marker);
  return {
    file: text.slice(0, index).trim(),
    name: text.slice(index + marker.length).trim(),
  };
};

export const refNamesTest = (
  value: string | null | undefined,
  failure: { file: string; testName: string }
): boolean => {
  const text = posix(value).trim();
  if (text.length === 0) return false;
  const name = failure.testName.trim();
  if (name.length === 0) return false;
  const parsed = splitTestRef(text);
  if (parsed.name === name) {
    return parsed.file.length === 0 || samePath(parsed.file, failure.file);
  }
  return text.includes(name);
};

const predicateResult = (
  failed: FailedSubject[],
  checked: string[],
  passed: string[],
  indeterminate: string | null = null
): PredicateResult => ({
  value: indeterminate === null && failed.length === 0,
  indeterminate,
  checked,
  passed,
  failed,
});

export type StaticProblem = {
  file?: string;
  line?: number;
  column?: number;
  severity?: string;
  code?: string;
  message: string;
};

export type StaticDetail = { problems?: readonly StaticProblem[] };

export type SyntaxEvidence = {
  missingUnits: readonly FailedSubject[];
  units: readonly { filePath: string; detail: StaticDetail | null }[];
  wide: StaticDetail | null;
};

export const syntaxPredicate = ({
  missingUnits,
  units,
  wide,
}: SyntaxEvidence): PredicateResult => {
  const checked: string[] = [];
  const passed: string[] = [];
  const failed: FailedSubject[] = [...missingUnits];

  for (const unit of units) {
    checked.push(unit.filePath);
    if (unit.detail === null) {
      failed.push({
        ref: unit.filePath,
        reason: "no static gate result is stored for this file",
        location: unit.filePath,
      });
      continue;
    }
    const problems = (unit.detail.problems ?? []).filter(
      (problem) =>
        problem.severity === "error" && samePath(problem.file, unit.filePath)
    );
    if (problems.length === 0) {
      passed.push(unit.filePath);
      continue;
    }
    for (const problem of problems) {
      failed.push({
        ref: unit.filePath,
        reason: `${problem.code ?? "error"}: ${problem.message}`,
        location: `${problem.file}:${problem.line ?? 0}:${problem.column ?? 0}`,
      });
    }
  }

  for (const problem of wide?.problems ?? []) {
    if (problem.severity !== "error") continue;
    if (units.some((unit) => samePath(problem.file, unit.filePath))) continue;
    failed.push({
      ref: problem.file ?? "<no file>",
      reason: `${problem.code ?? "error"}: ${problem.message}`,
      location: `${problem.file ?? "<no file>"}:${problem.line ?? 0}:${
        problem.column ?? 0
      }`,
    });
  }

  return predicateResult(failed, checked, passed);
};

export type EffectiveVerdict = {
  verdictId: number;
  subjectKind: string;
  subjectRef: string;
  ruleId: string | null;
  agentCallsign: string;
  post: string;
  verdict: string;
};

export type ApplicableRule = {
  filePath: string;
  ruleId: string;
  aspect: string;
  evaluable: boolean;
};

export type ConformanceEvidence = {
  missingUnits: readonly FailedSubject[];
  scope: string;
  liveRuleCount: number;
  applicable: readonly ApplicableRule[];
  verdicts: readonly EffectiveVerdict[];
  waived: readonly string[];
};

export const conformancePredicate = ({
  missingUnits,
  scope,
  liveRuleCount,
  applicable,
  verdicts,
  waived,
}: ConformanceEvidence): PredicateResult => {
  const waivers = new Set(waived);
  const checked: string[] = [];
  const passed: string[] = [];
  const failed: FailedSubject[] = [...missingUnits];

  if (liveRuleCount === 0) {
    failed.push({
      ref: `scope ${scope}`,
      reason:
        "the codex holds no live rule for this scope, so nothing judges conformance",
      location: "codex_rules_for",
    });
  }

  for (const entry of applicable) {
    const ref = `${entry.filePath}::${entry.ruleId}`;
    checked.push(ref);
    if (waivers.has(`rule::${entry.ruleId}`) || waivers.has(`rule::${ref}`)) {
      passed.push(ref);
      continue;
    }
    const latest = verdicts
      .filter(
        (verdict) =>
          verdict.subjectKind === "file" &&
          verdict.ruleId === entry.ruleId &&
          samePath(verdict.subjectRef, entry.filePath)
      )
      .at(-1);
    if (latest === undefined) {
      failed.push({
        ref,
        reason: entry.evaluable
          ? `rule ${entry.ruleId} of aspect ${entry.aspect} carries no verdict for this file`
          : `rule ${entry.ruleId} of aspect ${entry.aspect} could not be checked mechanically and carries no verdict for this file`,
        location: entry.filePath,
      });
      continue;
    }
    if (latest.verdict === "violation") {
      failed.push({
        ref,
        reason: `${latest.agentCallsign} recorded a violation of ${entry.ruleId}`,
        location: entry.filePath,
      });
      continue;
    }
    if (!CONFORMANCE_VERDICTS.some((allowed) => allowed === latest.verdict)) {
      failed.push({
        ref,
        reason: `verdict "${latest.verdict}" on ${entry.ruleId} is not pass and not not-applicable`,
        location: entry.filePath,
      });
      continue;
    }
    passed.push(ref);
  }

  return predicateResult(failed, checked, passed);
};

export type Divergence = {
  testKey: string;
  kind: string;
  statuses?: readonly string[];
};

export type UnparsedRun = { index: number; reportError: string };

export type FlakeDetail = {
  stable?: boolean;
  divergences?: readonly Divergence[];
  unparsedRuns?: readonly UnparsedRun[];
};

export type StableEvidence = {
  missingUnits: readonly FailedSubject[];
  units: readonly { filePath: string; detail: FlakeDetail | null }[];
};

export const stablePredicate = ({
  missingUnits,
  units,
}: StableEvidence): PredicateResult => {
  const checked: string[] = [];
  const passed: string[] = [];
  const failed: FailedSubject[] = [...missingUnits];

  for (const unit of units) {
    checked.push(unit.filePath);
    if (unit.detail === null) {
      failed.push({
        ref: unit.filePath,
        reason: "no flake probe result is stored for this file",
        location: unit.filePath,
      });
      continue;
    }
    const mine = (unit.detail.divergences ?? []).filter((divergence) =>
      samePath(splitTestRef(divergence.testKey).file, unit.filePath)
    );
    if (unit.detail.stable === true && mine.length === 0) {
      passed.push(unit.filePath);
      continue;
    }
    for (const divergence of mine) {
      failed.push({
        ref: unit.filePath,
        reason: `${divergence.kind} divergence across probe runs: ${(
          divergence.statuses ?? []
        ).join(", ")}`,
        location: divergence.testKey,
      });
    }
    if (mine.length > 0) continue;
    const unparsed = (unit.detail.unparsedRuns ?? []).at(0);
    failed.push({
      ref: unit.filePath,
      reason:
        unparsed === undefined
          ? "probe runs disagreed on the passed, failed and skipped counts"
          : `probe run ${unparsed.index} produced no readable report: ${unparsed.reportError}`,
      location: unit.filePath,
    });
  }

  return predicateResult(failed, checked, passed);
};

export type SuiteFailure = { file: string; testName: string };

export type SuiteTest = { file: string; testName: string; status: string };

export type SuiteDetail = {
  command?: string;
  reportParsed?: boolean;
  reportError?: string;
  failures?: readonly SuiteFailure[];
  tests?: readonly SuiteTest[];
};

export type FindingRecord = {
  findingKey: string;
  status: string;
  location: string;
};

export type VerifiedEvidence = {
  runId: number;
  suite: SuiteDetail | null;
  verdicts: readonly EffectiveVerdict[];
  findings: readonly FindingRecord[];
  waived: readonly string[];
};

export const verifiedPredicate = ({
  runId,
  suite,
  verdicts,
  findings,
  waived,
}: VerifiedEvidence): PredicateResult => {
  if (suite === null) {
    return predicateResult(
      [
        {
          ref: `run ${runId}`,
          reason: "no suite result is stored, so no red is accounted for",
          location: "gates_evaluate commands.test",
        },
      ],
      [],
      []
    );
  }
  if (suite.reportParsed === false) {
    return predicateResult(
      [
        {
          ref: `run ${runId}`,
          reason: `the suite result could not be read: ${suite.reportError}`,
          location: suite.command ?? "the test command",
        },
      ],
      [],
      []
    );
  }

  const checked: string[] = [];
  const passed: string[] = [];
  const failed: FailedSubject[] = [];

  for (const failure of suite.failures ?? []) {
    const ref = `${failure.file}::${failure.testName}`;
    checked.push(ref);
    const verdict = verdicts.some(
      (entry) =>
        entry.subjectKind === "test" &&
        isDefectVerdict(entry.verdict) &&
        refNamesTest(entry.subjectRef, failure)
    );
    const confirmed = findings.some(
      (entry) =>
        isDefectVerdict(entry.status) &&
        (refNamesTest(entry.findingKey, failure) ||
          refNamesTest(entry.location, failure))
    );
    const waiver = waived.some(
      (key) =>
        key.startsWith("finding::") && refNamesTest(key.slice(9), failure)
    );
    if (verdict || confirmed || waiver) {
      passed.push(ref);
      continue;
    }
    failed.push({
      ref,
      reason:
        "this test is red and carries no defect verifier verdict of confirmed-defect or confirmed-but-known",
      location: failure.file,
    });
  }

  return predicateResult(failed, checked, passed);
};

export type MutantRef = {
  id: number;
  filePath: string;
  line: number;
  operator: string;
};

export type MutationEvidence = {
  runId: number;
  mutantCount: number;
  survivors: readonly MutantRef[];
  unrun: readonly MutantRef[];
  waived: readonly string[];
};

export const mutationPredicate = ({
  runId,
  mutantCount,
  survivors,
  unrun,
  waived,
}: MutationEvidence): PredicateResult => {
  if (mutantCount === 0) {
    return predicateResult(
      [
        {
          ref: `run ${runId}`,
          reason:
            "no mutant is recorded for this run, so nothing proved the tests bite",
          location: "mutation_generate",
        },
      ],
      [],
      []
    );
  }

  const waivers = new Set(waived);
  const checked: string[] = [];
  const failed: FailedSubject[] = [];

  for (const mutant of survivors) {
    const ref = String(mutant.id);
    checked.push(ref);
    if (waivers.has(`mutant::${ref}`)) continue;
    failed.push({
      ref,
      reason: `mutant ${mutant.operator} survived with no upheld and signed equivalence claim`,
      location: `${mutant.filePath}:${mutant.line}`,
    });
  }
  for (const mutant of unrun) {
    const ref = String(mutant.id);
    checked.push(ref);
    if (waivers.has(`mutant::${ref}`)) continue;
    failed.push({
      ref,
      reason: `mutant ${mutant.operator} was never run to a verdict`,
      location: `${mutant.filePath}:${mutant.line}`,
    });
  }

  const passed = checked.filter(
    (ref) => !failed.some((item) => item.ref === ref)
  );
  return predicateResult(failed, checked, passed);
};

export type AttributionEntry = {
  testFile: string;
  testName: string;
  kills: number;
};

export type ValueEvidence = {
  runId: number;
  missingUnits: readonly FailedSubject[];
  roster: readonly string[];
  withoutKills: readonly string[];
  withoutUniqueKills: readonly string[];
  attribution: readonly AttributionEntry[];
  attributionComplete: boolean;
  waived: readonly string[];
};

export const valuePredicate = ({
  runId,
  missingUnits,
  roster,
  withoutKills,
  withoutUniqueKills,
  attribution,
  attributionComplete,
  waived,
}: ValueEvidence): PredicateResult => {
  if (!attributionComplete) {
    return predicateResult(
      [
        {
          ref: `run ${runId}`,
          reason: ATTRIBUTION_INCOMPLETE,
          location: "mutation_batch_run bail",
        },
      ],
      [...roster],
      [],
      ATTRIBUTION_INCOMPLETE
    );
  }

  if (roster.length === 0) {
    return predicateResult(
      [
        ...missingUnits,
        {
          ref: `run ${runId}`,
          reason:
            "no suite result names the tests whose value must be attributed",
          location: "gates_evaluate commands.test",
        },
      ],
      [],
      []
    );
  }

  const waivers = new Set(waived);
  const exempt = (ref: string): boolean =>
    waivers.has(`test-value::${ref}`) ||
    waivers.has(`test-value::${splitTestRef(ref).file}`);

  const unearned = [...new Set([...withoutKills, ...withoutUniqueKills])];
  const failed: FailedSubject[] = [...missingUnits];
  for (const ref of unearned) {
    if (exempt(ref)) continue;
    const killed = attribution.find(
      (entry) => `${entry.testFile}::${entry.testName}` === ref
    );
    failed.push({
      ref,
      reason:
        killed === undefined
          ? "killed no mutant at all"
          : `killed ${killed.kills} mutants but no mutant uniquely`,
      location: splitTestRef(ref).file,
    });
  }

  const passed = roster.filter(
    (ref) => !failed.some((item) => item.ref === ref)
  );
  return predicateResult(failed, [...roster], passed);
};

export type CoverageCell = {
  ref: string;
  matrixKey: string;
  rowKey: string;
  columnKey: string;
};

export type CompleteEvidence = {
  runId: number;
  totalCells: number;
  emptyCells: readonly CoverageCell[];
};

export const completePredicate = ({
  runId,
  totalCells,
  emptyCells,
}: CompleteEvidence): PredicateResult => {
  if (totalCells === 0) {
    return predicateResult(
      [
        {
          ref: `run ${runId}`,
          reason: "no coverage matrix cell is recorded for this run",
          location: "the coverage matrix",
        },
      ],
      [],
      []
    );
  }
  const failed = emptyCells.map((cell) => ({
    ref: cell.ref,
    reason: `matrix cell ${cell.rowKey} by ${cell.columnKey} is empty and unwaived`,
    location: cell.matrixKey,
  }));
  return predicateResult(
    failed,
    [`${totalCells} cells`],
    [
      `${
        totalCells - emptyCells.length
      } cells covered, waived or not applicable`,
    ]
  );
};

export type ClosureNodeRef = { nodeId: string; kind: string };

export type RadiusEvidence = {
  runId: number;
  totalNodes: number;
  unresolved: readonly ClosureNodeRef[];
  waived: readonly string[];
};

export const radiusPredicate = ({
  runId,
  totalNodes,
  unresolved,
  waived,
}: RadiusEvidence): PredicateResult => {
  if (totalNodes === 0) {
    return predicateResult(
      [
        {
          ref: `run ${runId}`,
          reason: "no effect closure node is recorded for this run",
          location: "closure_compute",
        },
      ],
      [],
      []
    );
  }
  const waivers = new Set(waived);
  const failed = unresolved
    .filter((node) => !waivers.has(`radius-node::${node.nodeId}`))
    .map((node) => ({
      ref: node.nodeId,
      reason: `${node.kind} node in the effect closure is unresolved`,
      location: node.nodeId,
    }));
  return predicateResult(
    failed,
    [`${totalNodes} nodes`],
    [`${totalNodes - failed.length} nodes resolved or waived`]
  );
};

export type FocusItem = { ref: string; lineNo: number; text: string };

export type FocusEvidence = {
  runId: number;
  totalLines: number;
  unmapped: readonly FocusItem[];
};

export const focusPredicate = ({
  runId,
  totalLines,
  unmapped,
}: FocusEvidence): PredicateResult => {
  if (totalLines === 0) {
    return predicateResult(
      [
        {
          ref: `run ${runId}`,
          reason: "the run carries no focus line to map a test against",
          location: "ledger_run_start",
        },
      ],
      [],
      []
    );
  }
  const failed = unmapped.map((item) => ({
    ref: item.ref,
    reason: `focus line ${item.lineNo} maps to no test and carries no waiver`,
    location: item.text,
  }));
  return predicateResult(
    failed,
    [`${totalLines} focus lines`],
    [`${totalLines - unmapped.length} focus lines mapped or waived`]
  );
};

export type OpenEscalationRef = {
  escalationKey: string;
  raisedBy: string;
  subjectRef: string;
  claim: string;
};

export type EscalationEvidence = {
  totalEscalations: number;
  open: readonly OpenEscalationRef[];
};

export const escalationPredicate = ({
  totalEscalations,
  open,
}: EscalationEvidence): PredicateResult =>
  predicateResult(
    open.map((entry) => ({
      ref: entry.escalationKey,
      reason: `${entry.raisedBy} raised "${entry.claim}" and it is still open`,
      location: entry.subjectRef,
    })),
    [`${totalEscalations} escalations`],
    [
      `${
        totalEscalations - open.length
      } escalations resolved with a named author and a written reason`,
    ]
  );

export type PredicateEvidence = {
  d1: SyntaxEvidence;
  d2: ConformanceEvidence;
  d3: StableEvidence;
  d4: VerifiedEvidence;
  d5: MutationEvidence;
  d6: ValueEvidence;
  d7: CompleteEvidence;
  d8: RadiusEvidence;
  d9: FocusEvidence;
  d10: EscalationEvidence;
};

export type PredicateResults = { [K in PredicateKey]: PredicateResult };

export const evaluatePredicates = (
  evidence: PredicateEvidence
): PredicateResults => ({
  d1: syntaxPredicate(evidence.d1),
  d2: conformancePredicate(evidence.d2),
  d3: stablePredicate(evidence.d3),
  d4: verifiedPredicate(evidence.d4),
  d5: mutationPredicate(evidence.d5),
  d6: valuePredicate(evidence.d6),
  d7: completePredicate(evidence.d7),
  d8: radiusPredicate(evidence.d8),
  d9: focusPredicate(evidence.d9),
  d10: escalationPredicate(evidence.d10),
});
