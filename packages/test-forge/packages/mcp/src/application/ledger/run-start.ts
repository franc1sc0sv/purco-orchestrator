import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { requireEnum } from "./ledger-input.ts";
import { SCOPES } from "test-forge-contracts/project";
import type { Scope } from "test-forge-contracts/project";

export const RUN_DEPTHS = ["full", "quick"] as const;

export type RunDepth = (typeof RUN_DEPTHS)[number];

export type RunStartInput = {
  cwd: string;
  focus?: string | undefined;
  scope: Scope;
  depth?: RunDepth | undefined;
};

export type RunStartResult = {
  projectKey: string;
  runId: number;
  scope: Scope;
  depth: RunDepth;
  focus: string;
  focusItems: number;
  startedAt: string;
};

export const runStart = async ({
  cwd,
  focus,
  scope,
  depth = "full",
}: RunStartInput): Promise<RunStartResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireEnum(scope, SCOPES, "scope");
  requireEnum(depth, RUN_DEPTHS, "depth");
  const focusText = focus ?? "";

  return tx(db, (txScope) => {
    const inserted = run(
      txScope.db,
      `INSERT INTO runs (project_key, focus, scope, depth) VALUES (?, ?, ?, ?)`,
      [projectKey, focusText, scope, depth],
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
      depth,
      focus: focusText,
      focusItems,
      startedAt: started?.started_at ?? "",
    };
  });
};
