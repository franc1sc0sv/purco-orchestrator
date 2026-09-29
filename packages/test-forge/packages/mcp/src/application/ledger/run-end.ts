import { openDb, run } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { requireEnum } from "./ledger-input.ts";
import { EXIT_KINDS } from "test-forge-contracts/gates";
import type { ExitKind } from "test-forge-contracts/gates";

export type RunEndInput = {
  cwd: string;
  runId: number;
  exitKind: ExitKind;
  exitReason?: string | undefined;
};

export type RunEndResult = {
  projectKey: string;
  runId: number;
  exitKind: ExitKind | null;
  exitReason: string | null;
  startedAt: string;
  endedAt: string | null;
};

export const runEnd = async ({
  cwd,
  runId,
  exitKind,
  exitReason,
}: RunEndInput): Promise<RunEndResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);
  requireEnum(exitKind, EXIT_KINDS, "exitKind");

  run(
    db,
    `UPDATE runs
        SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), exit_kind = ?, exit_reason = ?
      WHERE id = ? AND project_key = ?`,
    [exitKind, exitReason ?? "", runId, projectKey]
  );

  const row = requireRun(db, projectKey, runId);
  return {
    projectKey,
    runId,
    exitKind: row.exit_kind,
    exitReason: row.exit_reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
};
