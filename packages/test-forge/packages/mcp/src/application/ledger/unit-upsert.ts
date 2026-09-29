import { one, openDb, run } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import type { UnitRow, UnitState } from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { requireEnum, UNIT_STATES } from "./ledger-input.ts";

export type UnitUpsertInput = {
  cwd: string;
  runId: number;
  filePath: string;
  authorCallsign?: string | undefined;
  state?: UnitState | undefined;
};

export type UnitUpsertResult = {
  projectKey: string;
  runId: number;
  unitId: number;
  filePath: string;
  authorCallsign: string;
  state: UnitState;
};

export const unitUpsert = async ({
  cwd,
  runId,
  filePath,
  authorCallsign,
  state,
}: UnitUpsertInput): Promise<UnitUpsertResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);
  const nextState = requireEnum(state ?? "assigned", UNIT_STATES, "state");

  run(
    db,
    `INSERT INTO units (run_id, project_key, file_path, author_callsign, state)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (run_id, file_path) DO UPDATE
       SET author_callsign = excluded.author_callsign, state = excluded.state`,
    [runId, projectKey, filePath, authorCallsign ?? "unassigned", nextState]
  );

  const row = one<UnitRow>(
    db,
    `SELECT * FROM units WHERE run_id = ? AND file_path = ?`,
    [runId, filePath]
  );
  if (row === null) {
    throw new Error(`Unit "${filePath}" was not stored for run ${runId}`);
  }
  return {
    projectKey,
    runId,
    unitId: row.id,
    filePath: row.file_path,
    authorCallsign: row.author_callsign,
    state: row.state,
  };
};
