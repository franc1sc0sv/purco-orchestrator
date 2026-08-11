import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { resolve } from "node:path";
import type { ReplayResult, WarGameStatus } from "test-forge-contracts/board";

export type BoardReplayRecordInput = {
  cwd: string;
  scenarioKey?: string | undefined;
  scenarioId?: number | undefined;
  result: ReplayResult;
  note?: string | undefined;
};

export type BoardReplayRecordResult =
  | {
      recorded: true;
      replayId: number;
      scenarioId: number;
      result: ReplayResult;
      status: WarGameStatus;
    }
  | { recorded: false; reason: string };

type ScenarioStatusRow = { id: number; status: WarGameStatus };

const statusAfter = (
  result: ReplayResult,
  current: WarGameStatus,
): WarGameStatus => {
  if (result === "caught") return "passing";
  if (result === "missed") return "open";
  return current;
};

export const boardReplayRecord = async ({
  cwd,
  scenarioKey,
  scenarioId,
  result,
  note,
}: BoardReplayRecordInput): Promise<BoardReplayRecordResult> => {
  const db = openDb();
  const projectKey = await projectKeyOf(resolve(cwd));
  const scenario =
    scenarioId === undefined
      ? one<ScenarioStatusRow>(
          db,
          "SELECT id, status FROM war_games WHERE project_key = ? AND scenario_key = ?",
          [projectKey, scenarioKey ?? ""],
        )
      : one<ScenarioStatusRow>(
          db,
          "SELECT id, status FROM war_games WHERE id = ?",
          [scenarioId],
        );
  if (scenario === null) {
    return {
      recorded: false,
      reason: `no War Game for ${scenarioKey ?? scenarioId}`,
    };
  }

  const nextStatus = statusAfter(result, scenario.status);
  const replayId = tx(db, (txScope) => {
    const inserted = run(
      txScope.db,
      "INSERT INTO replays (scenario_id, result, note) VALUES (?, ?, ?)",
      [scenario.id, result, note ?? ""],
    );
    run(txScope.db, "UPDATE war_games SET status = ? WHERE id = ?", [
      nextStatus,
      scenario.id,
    ]);
    return Number(inserted.lastInsertRowid);
  });

  return {
    recorded: true,
    replayId,
    scenarioId: scenario.id,
    result,
    status: nextStatus,
  };
};
