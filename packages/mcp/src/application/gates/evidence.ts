import type {
  FlakeDetail,
  PredicateEvidence,
  StaticDetail,
  StaticProblem,
  SuiteDetail,
  SuiteFailure,
  SuiteTest,
} from "../../domain/gates/predicates.ts";
import { attributeKills } from "../../domain/mutation/attribution.ts";
import { all, one, openDb, run } from "../../infrastructure/db/connection.ts";
import { rulesFor } from "../codex/rules-for.ts";
import { isAbsolute, relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FailedSubject } from "test-forge-contracts/gates";
import type { Scope } from "test-forge-contracts/project";
import { isScope } from "test-forge-contracts/project";

export const EVIDENCE_KINDS = ["static", "flake", "suite"] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const EVIDENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS gate_evidence (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id      INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('static', 'flake', 'suite')),
  unit_path   TEXT NOT NULL DEFAULT '',
  ok          INTEGER NOT NULL DEFAULT 0 CHECK (ok IN (0, 1)),
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_gate_evidence_latest
  ON gate_evidence (run_id, kind, unit_path, id DESC);
`;

let evidenceReady = false;

export const openGateEvidence = (): DatabaseSync => {
  const db = openDb();
  if (!evidenceReady) {
    db.exec(EVIDENCE_SCHEMA);
    evidenceReady = true;
  }
  return db;
};

export type EvidenceRow = {
  id: number;
  kind: EvidenceKind;
  unit_path: string;
  ok: number;
  detail_json: string;
  created_at: string;
};

export const latestEvidence = (
  db: DatabaseSync,
  runId: number,
  kind: EvidenceKind,
  unitPath: string
): EvidenceRow | null =>
  one<EvidenceRow>(
    db,
    `SELECT * FROM gate_evidence
     WHERE run_id = ? AND kind = ? AND (unit_path = ? OR unit_path = '')
     ORDER BY id DESC LIMIT 1`,
    [runId, kind, unitPath]
  );

export const recordEvidence = ({
  db,
  projectKey,
  runId,
  kind,
  unitPath,
  ok,
  detail,
}: {
  db: DatabaseSync;
  projectKey: string;
  runId: number;
  kind: EvidenceKind;
  unitPath: string;
  ok: boolean;
  detail: unknown;
}): void => {
  run(
    db,
    `INSERT INTO gate_evidence (project_key, run_id, kind, unit_path, ok, detail_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectKey, runId, kind, unitPath, ok ? 1 : 0, JSON.stringify(detail)]
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const text = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const digit = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

const parseDetail = (
  row: EvidenceRow | null
): Record<string, unknown> | null => {
  if (row === null) return null;
  try {
    const parsed: unknown = JSON.parse(row.detail_json);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const problemOf = (source: Record<string, unknown>): StaticProblem => {
  const file = optionalText(source["file"]);
  const code = optionalText(source["code"]);
  const severity = optionalText(source["severity"]);
  return {
    message: text(source["message"], ""),
    line: digit(source["line"], 0),
    column: digit(source["column"], 0),
    ...(file === undefined ? {} : { file }),
    ...(code === undefined ? {} : { code }),
    ...(severity === undefined ? {} : { severity }),
  };
};

const staticDetailOf = (row: EvidenceRow | null): StaticDetail | null => {
  const detail = parseDetail(row);
  return detail === null
    ? null
    : { problems: records(detail["problems"]).map(problemOf) };
};

const flakeDetailOf = (row: EvidenceRow | null): FlakeDetail | null => {
  const detail = parseDetail(row);
  if (detail === null) return null;
  const stable = detail["stable"];
  return {
    divergences: records(detail["divergences"]).map((entry) => ({
      testKey: text(entry["testKey"], ""),
      kind: text(entry["kind"], "status"),
      statuses: Array.isArray(entry["statuses"])
        ? entry["statuses"].map((status) => text(status, "absent"))
        : [],
    })),
    unparsedRuns: records(detail["unparsedRuns"]).map((entry) => ({
      index: digit(entry["index"], 0),
      reportError: text(entry["reportError"], ""),
    })),
    ...(typeof stable === "boolean" ? { stable } : {}),
  };
};

const suiteDetailOf = (row: EvidenceRow | null): SuiteDetail | null => {
  const detail = parseDetail(row);
  if (detail === null) return null;
  const command = optionalText(detail["command"]);
  const reportError = optionalText(detail["reportError"]);
  const reportParsed = detail["reportParsed"];
  const failures: SuiteFailure[] = records(detail["failures"]).map((entry) => ({
    file: text(entry["file"], ""),
    testName: text(entry["testName"], ""),
  }));
  const tests: SuiteTest[] = records(detail["tests"]).map((entry) => ({
    file: text(entry["file"], ""),
    testName: text(entry["testName"], ""),
    status: text(entry["status"], ""),
  }));
  return {
    failures,
    tests,
    ...(command === undefined ? {} : { command }),
    ...(reportError === undefined ? {} : { reportError }),
    ...(typeof reportParsed === "boolean" ? { reportParsed } : {}),
  };
};

const posix = (value: string): string => value.split("\\").join("/");

export const repoRelative = (rootPath: string, value: string): string => {
  const normalised = posix(value).replace(/^\.\//, "");
  if (normalised.length === 0 || !isAbsolute(normalised)) return normalised;
  const fromRoot = posix(relative(rootPath, normalised));
  return fromRoot.length === 0 || fromRoot.startsWith("..")
    ? normalised
    : fromRoot;
};

const testReference = (rootPath: string, file: string, name: string): string =>
  `${repoRelative(rootPath, file)}::${name.trim()}`;

type CountRow = { total: number };

const countRows = (
  db: DatabaseSync,
  table: "mutants" | "coverage_cells" | "focus_items",
  runId: number
): number =>
  one<CountRow>(db, `SELECT COUNT(*) AS total FROM ${table} WHERE run_id = ?`, [
    runId,
  ])?.total ?? 0;

type RunScopeRow = { scope: string };

type UnitRow = { file_path: string };

type WaiverRow = { kind: string; ref: string };

type FindingRow = { finding_key: string; status: string; location: string };

type CellRow = { matrix_key: string; row_key: string; column_key: string };

type FocusRow = { line_no: number; text: string };

type MutantRow = {
  id: number;
  file_path: string;
  line: number;
  operator: string;
};

type KillRow = {
  mutant_id: number;
  test_name: string;
  file_path: string;
  attribution_complete: number;
};

type NodeRow = { node_ref: string; node_kind: string };

type OpenEscalationRow = {
  escalation_key: string;
  raised_by: string;
  subject_ref: string;
  claim: string;
};

type VerdictRow = {
  id: number;
  subject_kind: string;
  subject_ref: string;
  rule_id: string | null;
  agent_callsign: string;
  post: string;
  verdict: string;
};

export const runUnits = (db: DatabaseSync, runId: number): string[] =>
  all<UnitRow>(
    db,
    "SELECT file_path FROM units WHERE run_id = ? ORDER BY file_path",
    [runId]
  ).map((row) => row.file_path);

const runScope = (db: DatabaseSync, runId: number): string =>
  one<RunScopeRow>(db, "SELECT scope FROM runs WHERE id = ?", [runId])?.scope ??
  "";

const waiverKeys = (db: DatabaseSync, runId: number): string[] =>
  all<WaiverRow>(db, "SELECT kind, ref FROM waivers WHERE run_id = ?", [
    runId,
  ]).map((row) => `${row.kind}::${row.ref}`);

const effectiveVerdicts = (db: DatabaseSync, runId: number) =>
  all<VerdictRow>(
    db,
    `SELECT v.id, v.subject_kind, v.subject_ref, v.rule_id, v.agent_callsign, v.post,
            COALESCE(
              (SELECT o.correct_verdict FROM overturns o
                WHERE o.verdict_id = v.id ORDER BY o.id DESC LIMIT 1),
              v.verdict
            ) AS verdict
     FROM verdicts v
     WHERE v.run_id = ?
     ORDER BY v.id ASC`,
    [runId]
  ).map((row) => ({
    verdictId: row.id,
    subjectKind: row.subject_kind,
    subjectRef: row.subject_ref,
    ruleId: row.rule_id,
    agentCallsign: row.agent_callsign,
    post: row.post,
    verdict: row.verdict,
  }));

const applicableRules = async (
  cwd: string,
  scope: Scope | undefined,
  filePaths: readonly string[]
) => {
  const applicable: {
    filePath: string;
    ruleId: string;
    aspect: string;
    evaluable: boolean;
  }[] = [];
  for (const filePath of filePaths) {
    const held = await rulesFor({ cwd, scope, filePath });
    for (const rule of held.rules) {
      applicable.push({
        filePath,
        ruleId: rule.id,
        aspect: rule.aspect,
        evaluable: rule.applicability.rule.evaluable !== false,
      });
    }
  }
  return applicable;
};

export type EvidenceOptions = {
  cwd: string;
  runId: number;
  projectKey: string;
  rootPath: string;
};

export const gatherEvidence = async ({
  cwd,
  runId,
  projectKey,
  rootPath,
}: EvidenceOptions): Promise<PredicateEvidence> => {
  const db = openGateEvidence();
  const unitPaths = runUnits(db, runId);
  const waived = waiverKeys(db, runId);
  const waivers = new Set(waived);
  const verdicts = effectiveVerdicts(db, runId);
  const scope = runScope(db, runId);
  const typedScope = isScope(scope) ? scope : undefined;
  const suite = suiteDetailOf(latestEvidence(db, runId, "suite", ""));

  const missingUnits: FailedSubject[] =
    unitPaths.length === 0
      ? [
          {
            ref: `run ${runId}`,
            reason: "no test file is recorded as a unit of this run",
            location: "ledger_unit_upsert",
          },
        ]
      : [];

  const roster = (suite?.tests ?? [])
    .filter((entry) => entry.status !== "skipped")
    .map((entry) => testReference(rootPath, entry.file, entry.testName));

  const kills = all<KillRow>(
    db,
    `SELECT k.mutant_id, k.test_name, k.file_path, k.attribution_complete
     FROM kills k JOIN mutants m ON m.id = k.mutant_id
     WHERE m.project_key = ? AND m.run_id = ?`,
    [projectKey, runId]
  ).map((row) => ({
    mutantId: row.mutant_id,
    testFile: row.file_path,
    testName: row.test_name,
    attributionComplete: row.attribution_complete === 1,
  }));
  const attributed = attributeKills(kills, roster);

  const survivors = all<MutantRow>(
    db,
    `SELECT m.id, m.file_path, m.line, m.operator
     FROM mutants m
     WHERE m.project_key = ? AND m.run_id = ?
       AND m.outcome IN ('survived', 'equivalent-claimed', 'refuted')
       AND NOT EXISTS (
         SELECT 1 FROM equivalence_claims e
         WHERE e.mutant_id = m.id AND e.upheld = 1 AND e.signed_by IS NOT NULL
       )
     ORDER BY m.file_path, m.line`,
    [projectKey, runId]
  ).map((row) => ({
    id: row.id,
    filePath: row.file_path,
    line: row.line,
    operator: row.operator,
  }));

  const unrun = all<MutantRow>(
    db,
    `SELECT id, file_path, line, operator FROM mutants
     WHERE project_key = ? AND run_id = ? AND outcome IN ('pending', 'error', 'timeout')
     ORDER BY file_path, line`,
    [projectKey, runId]
  ).map((row) => ({
    id: row.id,
    filePath: row.file_path,
    line: row.line,
    operator: row.operator,
  }));

  const emptyCells = all<CellRow>(
    db,
    `SELECT matrix_key, row_key, column_key FROM coverage_cells
     WHERE run_id = ? AND state = 'empty'`,
    [runId]
  )
    .map((row) => ({
      ref: `${row.matrix_key}|${row.row_key}|${row.column_key}`,
      matrixKey: row.matrix_key,
      rowKey: row.row_key,
      columnKey: row.column_key,
    }))
    .filter((cell) => !waivers.has(`matrix-cell::${cell.ref}`));

  const unresolved = all<NodeRow>(
    db,
    `SELECT node_ref, node_kind FROM radius_nodes
     WHERE project_key = ? AND run_id = ? AND resolution = 'unresolved'
     ORDER BY node_kind, node_ref`,
    [projectKey, runId]
  ).map((row) => ({ nodeId: row.node_ref, kind: row.node_kind }));

  const totalNodes =
    one<CountRow>(
      db,
      "SELECT COUNT(*) AS total FROM radius_nodes WHERE project_key = ? AND run_id = ?",
      [projectKey, runId]
    )?.total ?? 0;

  const unmappedFocus = all<FocusRow>(
    db,
    `SELECT line_no, text FROM focus_items
     WHERE run_id = ? AND resolution = 'unmapped' ORDER BY line_no`,
    [runId]
  )
    .map((row) => ({
      ref: String(row.line_no),
      lineNo: row.line_no,
      text: row.text,
    }))
    .filter((item) => !waivers.has(`focus-line::${item.ref}`));

  const findings = all<FindingRow>(
    db,
    `SELECT finding_key, status, location FROM findings WHERE run_id = ?`,
    [runId]
  ).map((row) => ({
    findingKey: row.finding_key,
    status: row.status,
    location: row.location,
  }));

  const openEscalations = all<OpenEscalationRow>(
    db,
    `SELECT escalation_key, raised_by, subject_ref, claim FROM escalations
     WHERE project_key = ? AND run_id = ? AND state = 'open'
     ORDER BY id`,
    [projectKey, runId]
  ).map((row) => ({
    escalationKey: row.escalation_key,
    raisedBy: row.raised_by,
    subjectRef: row.subject_ref,
    claim: row.claim,
  }));

  const totalEscalations =
    one<CountRow>(
      db,
      "SELECT COUNT(*) AS total FROM escalations WHERE project_key = ? AND run_id = ?",
      [projectKey, runId]
    )?.total ?? 0;

  const liveRules = await rulesFor({ cwd, scope: typedScope });

  return {
    d1: {
      missingUnits,
      units: unitPaths.map((filePath) => ({
        filePath,
        detail: staticDetailOf(latestEvidence(db, runId, "static", filePath)),
      })),
      wide: staticDetailOf(latestEvidence(db, runId, "static", "")),
    },
    d2: {
      missingUnits,
      scope,
      liveRuleCount: liveRules.rules.length,
      applicable: await applicableRules(cwd, typedScope, unitPaths),
      verdicts,
      waived,
    },
    d3: {
      missingUnits,
      units: unitPaths.map((filePath) => ({
        filePath,
        detail: flakeDetailOf(latestEvidence(db, runId, "flake", filePath)),
      })),
    },
    d4: { runId, suite, verdicts, findings, waived },
    d5: {
      runId,
      mutantCount: countRows(db, "mutants", runId),
      survivors,
      unrun,
      waived,
    },
    d6: {
      runId,
      missingUnits,
      roster,
      withoutKills: attributed.withoutKills,
      withoutUniqueKills: attributed.withoutUniqueKills,
      attribution: attributed.attribution,
      attributionComplete: attributed.attributionComplete,
      waived,
    },
    d7: {
      runId,
      totalCells: countRows(db, "coverage_cells", runId),
      emptyCells,
    },
    d8: { runId, totalNodes, unresolved, waived },
    d9: {
      runId,
      totalLines: countRows(db, "focus_items", runId),
      unmapped: unmappedFocus,
    },
    d10: { totalEscalations, open: openEscalations },
  };
};
