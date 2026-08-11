import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { resolve } from "node:path";
import type { WarGameStatus } from "test-forge-contracts/board";

export type BoardWargameRecordInput = {
  cwd: string;
  scenarioKey: string;
  squad: string;
  post: string;
  aspect?: string | undefined;
  engagement?: Record<string, unknown> | string | undefined;
  whatHappened: string;
  whatWasCorrect: string;
  rootCause: string;
  status?: WarGameStatus | undefined;
};

export type BoardWargameRecordResult = {
  scenarioId: number;
  scenarioKey: string;
  status: WarGameStatus;
};

type ScenarioIdRow = { id: number };

const engagementJsonOf = (
  engagement: Record<string, unknown> | string | undefined,
): string =>
  typeof engagement === "string"
    ? engagement
    : JSON.stringify(engagement ?? {});

export const boardWargameRecord = async ({
  cwd,
  scenarioKey,
  squad,
  post,
  aspect,
  engagement,
  whatHappened,
  whatWasCorrect,
  rootCause,
  status,
}: BoardWargameRecordInput): Promise<BoardWargameRecordResult> => {
  const db = openDb();
  const projectKey = await projectKeyOf(resolve(cwd));
  const nextStatus: WarGameStatus = status ?? "open";
  const scenarioId = tx(db, (txScope) => {
    run(
      txScope.db,
      `INSERT INTO war_games (project_key, scenario_key, squad, post, aspect, engagement_json, what_happened, what_was_correct, root_cause, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_key, scenario_key)
       DO UPDATE SET squad = excluded.squad, post = excluded.post, aspect = excluded.aspect,
         engagement_json = excluded.engagement_json, what_happened = excluded.what_happened,
         what_was_correct = excluded.what_was_correct, root_cause = excluded.root_cause,
         status = excluded.status`,
      [
        projectKey,
        scenarioKey,
        squad,
        post,
        aspect ?? "",
        engagementJsonOf(engagement),
        whatHappened,
        whatWasCorrect,
        rootCause,
        nextStatus,
      ],
    );
    const stored = one<ScenarioIdRow>(
      txScope.db,
      "SELECT id FROM war_games WHERE project_key = ? AND scenario_key = ?",
      [projectKey, scenarioKey],
    );
    return stored?.id ?? 0;
  });
  return { scenarioId, scenarioKey, status: nextStatus };
};
