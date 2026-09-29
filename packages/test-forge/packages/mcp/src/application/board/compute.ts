import { rankOf } from "../../domain/board/ladder.ts";
import {
  DEFAULT_WINDOW,
  countByState,
  scoreBoard,
} from "../../domain/board/scoring.ts";
import { all, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import type { OutcomeRow } from "../../infrastructure/db/rows.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { resolve } from "node:path";
import type { BoardState, RankRow } from "test-forge-contracts/board";

export type BoardComputeInput = {
  cwd: string;
  window?: number | undefined;
};

export type BoardComputeResult = {
  board: RankRow[];
  counts: {
    posts: number;
    byState: Partial<Record<BoardState, number>>;
  };
  windowSize: number;
};

const persistRanks = (projectKey: string, board: readonly RankRow[]): void => {
  const db = openDb();
  tx(db, (txScope) => {
    for (const entry of board) {
      run(
        txScope.db,
        `INSERT INTO ranks (project_key, callsign, post, aspect, rank, score, trend, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (project_key, callsign, post, aspect)
         DO UPDATE SET rank = excluded.rank, score = excluded.score, trend = excluded.trend, updated_at = excluded.updated_at`,
        [
          projectKey,
          entry.callsign,
          entry.post,
          entry.aspect,
          entry.rank,
          entry.score,
          entry.trend,
        ],
      );
    }
  });
};

export const boardCompute = async ({
  cwd,
  window,
}: BoardComputeInput): Promise<BoardComputeResult> => {
  const db = openDb();
  const projectKey = await projectKeyOf(resolve(cwd));
  const windowSize = window ?? DEFAULT_WINDOW;
  const rows = all<
    Pick<
      OutcomeRow,
      "callsign" | "post" | "aspect" | "event_kind" | "weight" | "created_at"
    >
  >(
    db,
    `SELECT callsign, post, aspect, event_kind, weight, created_at
       FROM outcomes WHERE project_key = ?
      ORDER BY created_at ASC, id ASC`,
    [projectKey],
  );

  const board = scoreBoard(
    rows.map((row) => ({
      callsign: row.callsign,
      post: row.post,
      aspect: row.aspect,
      eventKind: row.event_kind,
      weight: row.weight,
    })),
    windowSize,
  ).map((post) => ({ ...post, rank: rankOf(post.score, post.outcomes) }));

  persistRanks(projectKey, board);

  return {
    board,
    counts: { posts: board.length, byState: countByState(board) },
    windowSize,
  };
};
