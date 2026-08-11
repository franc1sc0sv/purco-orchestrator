import { all, openDb } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import type {
  FindingRow,
  MutantRow,
  PassRow,
  RecordedVerdict,
  SubjectKind,
  UnitRow,
  WaiverRow,
} from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { PREDICATE_KEYS } from "./ledger-input.ts";
import type { DoneVector } from "test-forge-contracts/gates";

export type StateInput = {
  cwd: string;
  runId: number;
};

type UnitSummary = Pick<
  UnitRow,
  "id" | "file_path" | "author_callsign" | "state"
>;

type VerdictSummaryRow = {
  id: number;
  subject_kind: SubjectKind;
  subject_ref: string;
  agent_callsign: string;
  post: string;
  rule_id: string | null;
  verdict: RecordedVerdict;
  created_at: string;
};

type SubjectVerdict = {
  verdictId: number;
  agentCallsign: string;
  post: string;
  ruleId: string | null;
  verdict: RecordedVerdict;
  createdAt: string;
};

type CellRow = { matrix_key: string; row_key: string; column_key: string };

type SurvivingMutantRow = Pick<
  MutantRow,
  "id" | "file_path" | "line" | "operator" | "outcome"
> & { signed_claims: number };

type OpenBlock = {
  predicate: string;
  reason: string;
  refs: string[];
};

const toVector = (row: PassRow): DoneVector => ({
  d1: row.d1 === 1,
  d2: row.d2 === 1,
  d3: row.d3 === 1,
  d4: row.d4 === 1,
  d5: row.d5 === 1,
  d6: row.d6 === 1,
  d7: row.d7 === 1,
  d8: row.d8 === 1,
  d9: row.d9 === 1,
  d10: row.d10 === 1,
});

const cellRef = (row: CellRow): string =>
  `${row.matrix_key}|${row.row_key}|${row.column_key}`;

export const state = async ({ cwd, runId }: StateInput) => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const run = requireRun(db, projectKey, runId);

  const units = all<UnitSummary>(
    db,
    `SELECT id, file_path, author_callsign, state FROM units WHERE run_id = ? ORDER BY file_path`,
    [runId]
  ).map((row) => ({
    unitId: row.id,
    filePath: row.file_path,
    authorCallsign: row.author_callsign,
    state: row.state,
  }));

  const passRows = all<PassRow>(
    db,
    `SELECT * FROM passes WHERE run_id = ? ORDER BY pass_no ASC`,
    [runId]
  );
  const latest = passRows[passRows.length - 1];
  const previous = passRows[passRows.length - 2];

  const waivers = all<WaiverRow>(
    db,
    `SELECT id, kind, ref, reason, signed_by, created_at FROM waivers WHERE run_id = ? ORDER BY kind, ref`,
    [runId]
  );
  const waived = new Set(waivers.map((row) => `${row.kind}::${row.ref}`));

  const verdictRows = all<VerdictSummaryRow>(
    db,
    `SELECT id, subject_kind, subject_ref, agent_callsign, post, rule_id, verdict, created_at
       FROM verdicts WHERE run_id = ? ORDER BY created_at ASC`,
    [runId]
  );
  const verdictsBySubject = new Map<string, SubjectVerdict[]>();
  for (const row of verdictRows) {
    const key = `${row.subject_kind}::${row.subject_ref}`;
    const entries = verdictsBySubject.get(key) ?? [];
    entries.push({
      verdictId: row.id,
      agentCallsign: row.agent_callsign,
      post: row.post,
      ruleId: row.rule_id,
      verdict: row.verdict,
      createdAt: row.created_at,
    });
    verdictsBySubject.set(key, entries);
  }

  const findings = all<FindingRow>(
    db,
    `SELECT id, finding_key, severity, title, location, evidence, proposed_fix, status, created_at
       FROM findings WHERE run_id = ? ORDER BY severity, created_at`,
    [runId]
  ).map((row) => ({
    findingId: row.id,
    findingKey: row.finding_key,
    severity: row.severity,
    title: row.title,
    location: row.location,
    evidence: row.evidence,
    proposedFix: row.proposed_fix,
    status: row.status,
    createdAt: row.created_at,
    waived: waived.has(`finding::${row.finding_key}`),
    verdicts: verdictsBySubject.get(`finding::${row.finding_key}`) ?? [],
  }));

  const emptyCells = all<CellRow>(
    db,
    `SELECT matrix_key, row_key, column_key FROM coverage_cells WHERE run_id = ? AND state = 'empty'`,
    [runId]
  )
    .map((row) => ({
      ref: cellRef(row),
      matrixKey: row.matrix_key,
      rowKey: row.row_key,
      columnKey: row.column_key,
    }))
    .filter((cell) => !waived.has(`matrix-cell::${cell.ref}`));

  const unresolvedNodes = all<{ node_ref: string; node_kind: string }>(
    db,
    `SELECT node_ref, node_kind FROM radius_nodes WHERE run_id = ? AND resolution = 'unresolved'`,
    [runId]
  )
    .map((row) => ({ ref: row.node_ref, kind: row.node_kind }))
    .filter((node) => !waived.has(`radius-node::${node.ref}`));

  const unmappedFocus = all<{ line_no: number; text: string }>(
    db,
    `SELECT line_no, text FROM focus_items WHERE run_id = ? AND resolution = 'unmapped' ORDER BY line_no`,
    [runId]
  )
    .map((row) => ({
      ref: String(row.line_no),
      lineNo: row.line_no,
      text: row.text,
    }))
    .filter((item) => !waived.has(`focus-line::${item.ref}`));

  const mutantRows = all<SurvivingMutantRow>(
    db,
    `SELECT m.id, m.file_path, m.line, m.operator, m.outcome,
            (SELECT COUNT(*) FROM equivalence_claims e
              WHERE e.mutant_id = m.id AND e.upheld = 1 AND e.signed_by IS NOT NULL) AS signed_claims
       FROM mutants m WHERE m.run_id = ?`,
    [runId]
  );
  const survivingMutants = mutantRows
    .filter(
      (row) =>
        (row.outcome === "survived" ||
          row.outcome === "error" ||
          row.outcome === "timeout" ||
          (row.outcome === "equivalent-claimed" && row.signed_claims === 0)) &&
        !waived.has(`mutant::${row.id}`)
    )
    .map((row) => ({
      mutantId: row.id,
      filePath: row.file_path,
      line: row.line,
      operator: row.operator,
      outcome: row.outcome,
    }));

  const unverifiedFindings = findings.filter(
    (finding) =>
      finding.severity === "blocking" &&
      finding.status === "open" &&
      !finding.waived &&
      !finding.verdicts.some(
        (entry) =>
          entry.verdict === "confirmed-defect" ||
          entry.verdict === "confirmed-but-known"
      )
  );

  const unfinishedUnits = units.filter(
    (unit) => unit.state !== "accepted" && unit.state !== "abandoned"
  );

  const openBlocks: OpenBlock[] = [];
  if (unfinishedUnits.length > 0) {
    openBlocks.push({
      predicate: "units",
      reason: "Test files are still in flight.",
      refs: unfinishedUnits.map((unit) => `${unit.filePath} (${unit.state})`),
    });
  }
  if (unverifiedFindings.length > 0) {
    openBlocks.push({
      predicate: "D4",
      reason: "Blocking findings carry no Noble Team verdict.",
      refs: unverifiedFindings.map((finding) => finding.findingKey),
    });
  }
  if (survivingMutants.length > 0) {
    openBlocks.push({
      predicate: "D5",
      reason: "Mutants survived without a signed equivalence claim.",
      refs: survivingMutants.map(
        (mutant) =>
          `${mutant.filePath}:${mutant.line} ${mutant.operator} (${mutant.outcome})`
      ),
    });
  }
  if (emptyCells.length > 0) {
    openBlocks.push({
      predicate: "D7",
      reason: "Coverage matrix cells are empty and unwaived.",
      refs: emptyCells.map((cell) => cell.ref),
    });
  }
  if (unresolvedNodes.length > 0) {
    openBlocks.push({
      predicate: "D8",
      reason: "Effect closure nodes are unresolved and unwaived.",
      refs: unresolvedNodes.map((node) => node.ref),
    });
  }
  if (unmappedFocus.length > 0) {
    openBlocks.push({
      predicate: "D9",
      reason: "Focus lines map to no test and carry no waiver.",
      refs: unmappedFocus.map((item) => `${item.lineNo}: ${item.text}`),
    });
  }

  return {
    projectKey,
    run: {
      runId: run.id,
      focus: run.focus,
      scope: run.scope,
      startedAt: run.started_at,
      endedAt: run.ended_at,
      exitKind: run.exit_kind,
      exitReason: run.exit_reason,
    },
    units,
    unitCounts: units.reduce<Record<string, number>>(
      (counts, unit) => ({
        ...counts,
        [unit.state]: (counts[unit.state] ?? 0) + 1,
      }),
      {}
    ),
    passes: passRows.map((row) => ({
      passNo: row.pass_no,
      predicates: toVector(row),
      createdAt: row.created_at,
    })),
    latestPass:
      latest === undefined
        ? null
        : {
            passNo: latest.pass_no,
            predicates: toVector(latest),
            failing: PREDICATE_KEYS.filter((key) => latest[key] !== 1),
            allGreen: PREDICATE_KEYS.every((key) => latest[key] === 1),
            stalled:
              previous !== undefined &&
              PREDICATE_KEYS.every((key) => previous[key] === latest[key]),
          },
    findings,
    waivers: waivers.map((row) => ({
      waiverId: row.id,
      kind: row.kind,
      ref: row.ref,
      reason: row.reason,
      signedBy: row.signed_by,
      createdAt: row.created_at,
    })),
    verdicts: verdictRows.map((row) => ({
      verdictId: row.id,
      subjectKind: row.subject_kind,
      subjectRef: row.subject_ref,
      agentCallsign: row.agent_callsign,
      post: row.post,
      ruleId: row.rule_id,
      verdict: row.verdict,
      createdAt: row.created_at,
    })),
    coverage: { emptyCells },
    radius: { unresolvedNodes },
    focus: { unmapped: unmappedFocus },
    mutation: {
      surviving: survivingMutants,
      pending: mutantRows.filter((row) => row.outcome === "pending").length,
      total: mutantRows.length,
    },
    openBlocks,
  };
};
