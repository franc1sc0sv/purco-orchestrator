import { all, one, openDb } from "../../infrastructure/db/connection.ts";
import { toReplay, toWarGameScenario } from "../../infrastructure/db/rows.ts";
import type { ReplayRow, WarGameRow } from "../../infrastructure/db/rows.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { resolve } from "node:path";
import type {
  WarGameScenario,
  WarGameStatus,
} from "test-forge-contracts/board";

export type BoardWargameListInput = {
  cwd: string;
  status?: WarGameStatus | undefined;
  aspect?: string | undefined;
  post?: string | undefined;
};

export type BoardWargameListResult = {
  scenarios: WarGameScenario[];
  count: number;
};

export const boardWargameList = async ({
  cwd,
  status,
  aspect,
  post,
}: BoardWargameListInput): Promise<BoardWargameListResult> => {
  const db = openDb();
  const projectKey = await projectKeyOf(resolve(cwd));
  const clauses = ["project_key = ?"];
  const values: string[] = [projectKey];
  if (status) {
    clauses.push("status = ?");
    values.push(status);
  }
  if (aspect) {
    clauses.push("aspect = ?");
    values.push(aspect);
  }
  if (post) {
    clauses.push("post = ?");
    values.push(post);
  }

  const rows = all<WarGameRow>(
    db,
    `SELECT id, project_key, scenario_key, squad, post, aspect, engagement_json,
            what_happened, what_was_correct, root_cause, status, created_at
       FROM war_games WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
    values
  );

  const scenarios = rows.map((row) => {
    const replay = one<ReplayRow>(
      db,
      "SELECT id, scenario_id, result, note, created_at FROM replays WHERE scenario_id = ? ORDER BY created_at DESC LIMIT 1",
      [row.id]
    );
    return toWarGameScenario(row, replay === null ? null : toReplay(replay));
  });

  return { scenarios, count: scenarios.length };
};
