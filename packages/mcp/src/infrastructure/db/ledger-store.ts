import { one, run } from "./connection.ts";
import type {
  FindingStatus,
  FocusResolution,
  RecordedVerdict,
  RunRow,
} from "./rows.ts";
import type { DatabaseSync } from "node:sqlite";

const FINDING_STATUS_OF_VERDICT: Partial<
  Record<RecordedVerdict, FindingStatus>
> = {
  "confirmed-defect": "confirmed-defect",
  "confirmed-but-known": "confirmed-but-known",
  "not-a-defect": "rejected",
};

export const requireRun = (
  db: DatabaseSync,
  projectKey: string,
  runId: number,
): RunRow => {
  const row = one<RunRow>(
    db,
    `SELECT * FROM runs WHERE id = ? AND project_key = ?`,
    [runId, projectKey],
  );
  if (row === null) {
    throw new Error(`Run ${runId} does not belong to project ${projectKey}`);
  }
  return row;
};

export const applyFindingVerdict = (
  db: DatabaseSync,
  runId: number,
  findingKey: string,
  verdict: RecordedVerdict,
): FindingStatus | null => {
  const status = FINDING_STATUS_OF_VERDICT[verdict];
  if (status === undefined) return null;
  run(
    db,
    `UPDATE findings SET status = ? WHERE run_id = ? AND finding_key = ?`,
    [status, runId, findingKey],
  );
  return status;
};

export const applyFocusVerdict = (
  db: DatabaseSync,
  runId: number,
  lineRef: string,
  verdict: RecordedVerdict,
  testRef: string,
): FocusResolution | null => {
  if (verdict !== "pass") return null;
  const lineNo = Number.parseInt(lineRef, 10);
  const updated = Number.isNaN(lineNo)
    ? 0
    : Number(
        run(
          db,
          `UPDATE focus_items SET resolution = 'mapped', test_ref = ?
           WHERE run_id = ? AND line_no = ?`,
          [testRef, runId, lineNo],
        ).changes,
      );
  if (updated === 0) {
    throw new Error(
      `Focus line ${lineRef} is not part of run ${runId}. The subjectRef of a focus-item is the line number ledger_run_start assigned.`,
    );
  }
  return "mapped";
};
