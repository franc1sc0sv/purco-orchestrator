import { one, openDb, run } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import type {
  FindingRow,
  FindingStatus,
} from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { FINDING_STATUSES, requireEnum } from "./ledger-input.ts";
import { SEVERITIES } from "test-forge-contracts/codex";
import type { Severity } from "test-forge-contracts/codex";

export type FindingUpsertInput = {
  cwd: string;
  runId: number;
  findingKey: string;
  severity?: Severity | undefined;
  title?: string | undefined;
  location?: string | undefined;
  evidence?: string | undefined;
  proposedFix?: string | undefined;
  status?: FindingStatus | undefined;
};

export type FindingUpsertResult = {
  projectKey: string;
  runId: number;
  findingId: number;
  findingKey: string;
  severity: Severity;
  status: FindingStatus;
  deduplicated: boolean;
};

export const findingUpsert = async ({
  cwd,
  runId,
  findingKey,
  severity,
  title,
  location,
  evidence,
  proposedFix,
  status,
}: FindingUpsertInput): Promise<FindingUpsertResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);
  const nextSeverity = requireEnum(
    severity ?? "advisory",
    SEVERITIES,
    "severity"
  );
  const nextStatus = requireEnum(status ?? "open", FINDING_STATUSES, "status");

  const before = one<{ id: number }>(
    db,
    `SELECT id FROM findings WHERE run_id = ? AND finding_key = ?`,
    [runId, findingKey]
  );

  run(
    db,
    `INSERT INTO findings
       (project_key, run_id, finding_key, severity, title, location, evidence, proposed_fix, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (run_id, finding_key) DO UPDATE
       SET severity = excluded.severity,
           title = excluded.title,
           location = excluded.location,
           evidence = excluded.evidence,
           proposed_fix = excluded.proposed_fix,
           status = excluded.status`,
    [
      projectKey,
      runId,
      findingKey,
      nextSeverity,
      title ?? "",
      location ?? "",
      evidence ?? "",
      proposedFix ?? "",
      nextStatus,
    ]
  );

  const row = one<FindingRow>(
    db,
    `SELECT * FROM findings WHERE run_id = ? AND finding_key = ?`,
    [runId, findingKey]
  );
  if (row === null) {
    throw new Error(`Finding "${findingKey}" was not stored for run ${runId}`);
  }
  return {
    projectKey,
    runId,
    findingId: row.id,
    findingKey: row.finding_key,
    severity: row.severity,
    status: row.status,
    deduplicated: before !== null,
  };
};
