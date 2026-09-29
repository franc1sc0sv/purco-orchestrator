import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { requireEnum } from "./ledger-input.ts";
import { SCOPES } from "test-forge-contracts/project";
import type { Scope } from "test-forge-contracts/project";

export type RunStartInput = {
  cwd: string;
  focus?: string | undefined;
  scope: Scope;
};

export type RunStartResult = {
  projectKey: string;
  runId: number;
  scope: Scope;
  focus: string;
  focusItems: number;
  startedAt: string;
};

export const runStart = async ({
  cwd,
  focus,
  scope,
}: RunStartInput): Promise<RunStartResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireEnum(scope, SCOPES, "scope");
  const focusText = focus ?? "";

  return tx(db, (txScope) => {
    const inserted = run(
      txScope.db,
      `INSERT INTO runs (project_key, focus, scope) VALUES (?, ?, ?)`,
      [projectKey, focusText, scope],
    );
    const runId = Number(inserted.lastInsertRowid);

    let focusItems = 0;
    focusText.split(/\r?\n/).forEach((text, index) => {
      if (text.trim().length === 0) return;
      run(
        txScope.db,
        `INSERT INTO focus_items (project_key, run_id, line_no, text) VALUES (?, ?, ?, ?)`,
        [projectKey, runId, index + 1, text],
      );
      focusItems += 1;
    });

    const started = one<{ started_at: string }>(
      txScope.db,
      `SELECT started_at FROM runs WHERE id = ?`,
      [runId],
    );
    return {
      projectKey,
      runId,
      scope,
      focus: focusText,
      focusItems,
      startedAt: started?.started_at ?? "",
    };
  });
};
