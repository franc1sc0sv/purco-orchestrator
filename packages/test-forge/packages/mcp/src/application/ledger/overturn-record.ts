import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { applyFindingVerdict } from "../../infrastructure/db/ledger-store.ts";
import type {
  FindingStatus,
  RecordedVerdict,
  VerdictRow,
} from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { RECORDED_VERDICTS, requireEnum } from "./ledger-input.ts";

export type OverturnRecordInput = {
  cwd: string;
  verdictId: number;
  overturnedBy?: string | undefined;
  correctVerdict: RecordedVerdict;
  reason?: string | undefined;
};

export type OverturnRecordResult = {
  projectKey: string;
  overturnId: number;
  verdictId: number;
  originalVerdict: RecordedVerdict;
  correctVerdict: RecordedVerdict;
  findingStatus: FindingStatus | null;
};

export const overturnRecord = async ({
  cwd,
  verdictId,
  overturnedBy,
  correctVerdict,
  reason,
}: OverturnRecordInput): Promise<OverturnRecordResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const verdict = one<VerdictRow>(
    db,
    `SELECT * FROM verdicts WHERE id = ? AND project_key = ?`,
    [verdictId, projectKey],
  );
  if (verdict === null) {
    throw new Error(
      `Verdict ${verdictId} does not belong to project ${projectKey}`,
    );
  }
  requireEnum(correctVerdict, RECORDED_VERDICTS, "correctVerdict");

  return tx(db, (txScope) => {
    const inserted = run(
      txScope.db,
      `INSERT INTO overturns (project_key, verdict_id, overturned_by, correct_verdict, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [
        projectKey,
        verdictId,
        overturnedBy ?? "human",
        correctVerdict,
        reason ?? "",
      ],
    );

    return {
      projectKey,
      overturnId: Number(inserted.lastInsertRowid),
      verdictId,
      originalVerdict: verdict.verdict,
      correctVerdict,
      findingStatus:
        verdict.subject_kind === "finding"
          ? applyFindingVerdict(
              txScope.db,
              verdict.run_id,
              verdict.subject_ref,
              correctVerdict,
            )
          : null,
    };
  });
};
