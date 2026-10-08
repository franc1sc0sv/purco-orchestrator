import { all, one, run, tx } from "./connection.ts";
import { recordKills } from "./kill-store.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Kill, MutantOutcome } from "test-forge-contracts/mutation";
import type { MutantSite } from "test-forge-contracts/stryker";
import { siteKey } from "../../domain/stryker/scope.ts";

export type StrykerMutantRecord = {
  site: MutantSite;
  originalText: string;
  outcome: MutantOutcome;
  strykerStatus: string;
  coveredBy: readonly Kill[];
  killedBy: readonly Kill[];
};

const MAX_ORIGINAL_TEXT = 500;

const FIND_SITE = `
SELECT id FROM mutants
 WHERE run_id = ? AND engine = 'stryker' AND file_path = ? AND line = ?
   AND start_column = ? AND end_line = ? AND end_column = ?
   AND operator = ? AND after_text = ?`;

const UPDATE_MUTANT = `
UPDATE mutants
   SET outcome = ?, stryker_status = ?, covered_by_json = ?, before_text = ?
 WHERE id = ?`;

const INSERT_MUTANT = `
INSERT INTO mutants
  (project_key, run_id, file_path, line, operator, before_text, after_text,
   outcome, engine, start_column, end_line, end_column, stryker_status, covered_by_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stryker', ?, ?, ?, ?, ?)`;

const writeOne = (
  db: DatabaseSync,
  projectKey: string,
  runId: number,
  record: StrykerMutantRecord,
): void => {
  const { site } = record;
  const before = record.originalText.slice(0, MAX_ORIGINAL_TEXT);
  const covered = JSON.stringify(record.coveredBy);
  const existing = one<{ id: number }>(db, FIND_SITE, [
    runId,
    site.file,
    site.start.line,
    site.start.column,
    site.end.line,
    site.end.column,
    site.mutator,
    site.replacement,
  ]);
  const mutantId =
    existing === null
      ? Number(
          run(db, INSERT_MUTANT, [
            projectKey,
            runId,
            site.file,
            site.start.line,
            site.mutator,
            before,
            site.replacement,
            record.outcome,
            site.start.column,
            site.end.line,
            site.end.column,
            record.strykerStatus,
            covered,
          ]).lastInsertRowid,
        )
      : existing.id;
  if (existing !== null) {
    run(db, UPDATE_MUTANT, [
      record.outcome,
      record.strykerStatus,
      covered,
      before,
      mutantId,
    ]);
  }
  recordKills({
    db,
    mutantId,
    kills: record.killedBy,
    attributionComplete: false,
  });
};

export type PlannedSite = { site: MutantSite; originalText: string };

export const planStrykerSites = (
  db: DatabaseSync,
  projectKey: string,
  runId: number,
  planned: readonly PlannedSite[],
): Map<string, number> =>
  tx(db, (scope) => {
    const ids = new Map<string, number>();
    for (const { site, originalText } of planned) {
      const existing = one<{ id: number }>(scope.db, FIND_SITE, [
        runId,
        site.file,
        site.start.line,
        site.start.column,
        site.end.line,
        site.end.column,
        site.mutator,
        site.replacement,
      ]);
      const id =
        existing === null
          ? Number(
              run(scope.db, INSERT_MUTANT, [
                projectKey,
                runId,
                site.file,
                site.start.line,
                site.mutator,
                originalText.slice(0, MAX_ORIGINAL_TEXT),
                site.replacement,
                "pending",
                site.start.column,
                site.end.line,
                site.end.column,
                "Pending",
                "[]",
              ]).lastInsertRowid,
            )
          : existing.id;
      ids.set(siteKey(site), id);
    }
    return ids;
  });

export const recordStrykerMutants = (
  db: DatabaseSync,
  projectKey: string,
  runId: number,
  records: readonly StrykerMutantRecord[],
): number =>
  tx(db, (scope) => {
    for (const record of records) writeOne(scope.db, projectKey, runId, record);
    return records.length;
  });

export type StrykerRow = {
  id: number;
  site: MutantSite;
  originalText: string;
  outcome: MutantOutcome;
  coveredBy: Kill[];
};

type StrykerRowRecord = {
  id: number;
  file_path: string;
  line: number;
  start_column: number;
  end_line: number;
  end_column: number;
  operator: string;
  before_text: string;
  after_text: string;
  outcome: MutantOutcome;
  covered_by_json: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const killsOf = (json: string): Kill[] => {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) =>
      isRecord(entry) &&
      typeof entry["file"] === "string" &&
      typeof entry["name"] === "string"
        ? [{ file: entry["file"], name: entry["name"] }]
        : [],
    );
  } catch {
    return [];
  }
};

const rowOf = (row: StrykerRowRecord): StrykerRow => ({
  id: row.id,
  site: {
    file: row.file_path,
    mutator: row.operator,
    replacement: row.after_text,
    start: { line: row.line, column: row.start_column },
    end: { line: row.end_line, column: row.end_column },
  },
  originalText: row.before_text,
  outcome: row.outcome,
  coveredBy: killsOf(row.covered_by_json),
});

const SELECT_ROWS = `
SELECT id, file_path, line, start_column, end_line, end_column, operator,
       before_text, after_text, outcome, covered_by_json
  FROM mutants
 WHERE run_id = ? AND engine = 'stryker'
 ORDER BY file_path, line, start_column, id`;

export const strykerRowsOf = (db: DatabaseSync, runId: number): StrykerRow[] =>
  all<StrykerRowRecord>(db, SELECT_ROWS, [runId]).map(rowOf);

export type SoloSettledRow = {
  id: number;
  mutator: string;
  outcome: MutantOutcome;
  strykerStatus: string;
  coveredBy: Kill[];
  killedBy: Kill[];
};

type SoloSettledRecord = {
  id: number;
  operator: string;
  outcome: MutantOutcome;
  stryker_status: string;
  covered_by_json: string;
};

type KillRecord = { file_path: string; test_name: string };

const SELECT_SOLO_SETTLED = `
SELECT id, operator, outcome, stryker_status, covered_by_json
  FROM mutants
 WHERE run_id = ? AND engine = 'stryker' AND stryker_status LIKE '%Solo'`;

export const soloSettledRowsOf = (
  db: DatabaseSync,
  runId: number,
): SoloSettledRow[] =>
  all<SoloSettledRecord>(db, SELECT_SOLO_SETTLED, [runId]).map((row) => ({
    id: row.id,
    mutator: row.operator,
    outcome: row.outcome,
    strykerStatus: row.stryker_status,
    coveredBy: killsOf(row.covered_by_json),
    killedBy: all<KillRecord>(
      db,
      "SELECT file_path, test_name FROM kills WHERE mutant_id = ?",
      [row.id],
    ).map((kill) => ({ file: kill.file_path, name: kill.test_name })),
  }));

export const recordSoloOutcome = (
  db: DatabaseSync,
  mutantId: number,
  outcome: MutantOutcome,
  strykerStatus: string,
  killedBy: readonly Kill[],
): void => {
  tx(db, (scope) => {
    run(scope.db, "UPDATE mutants SET outcome = ?, stryker_status = ? WHERE id = ?", [
      outcome,
      strykerStatus,
      mutantId,
    ]);
    recordKills({
      db: scope.db,
      mutantId,
      kills: killedBy,
      attributionComplete: false,
    });
  });
};
