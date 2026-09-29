import { openDb, run } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import { resolveProject } from "../../infrastructure/project.ts";

export type RunReopenInput = {
  cwd: string;
  runId: number;
};

export type RunReopenResult = {
  runId: number;
  reopened: boolean;
  previousExitKind: string | null;
};

export const runReopen = async ({
  cwd,
  runId,
}: RunReopenInput): Promise<RunReopenResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const before = requireRun(db, projectKey, runId);
  if (before.exit_kind !== "BLOCKED") {
    return { runId, reopened: false, previousExitKind: before.exit_kind };
  }
  run(
    db,
    `UPDATE runs SET ended_at = NULL, exit_kind = NULL, exit_reason = NULL
      WHERE id = ? AND project_key = ?`,
    [runId, projectKey],
  );
  return { runId, reopened: true, previousExitKind: before.exit_kind };
};
