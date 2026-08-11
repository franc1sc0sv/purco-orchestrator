import { attentionFor, weakestPost } from "../../domain/board/attention.ts";
import type { Attention } from "../../domain/board/attention.ts";
import { one, openDb } from "../../infrastructure/db/connection.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { boardCompute } from "./compute.ts";
import { resolve } from "node:path";

export type BoardAttentionInput = {
  cwd: string;
};

export type BoardAttentionResult = Attention;

type OpenGamesRow = { total: number };

export const boardAttention = async ({
  cwd,
}: BoardAttentionInput): Promise<BoardAttentionResult> => {
  const db = openDb();
  const projectKey = await projectKeyOf(resolve(cwd));
  const { board } = await boardCompute({ cwd });
  const weakest = weakestPost(board);
  if (weakest === undefined) return attentionFor({ board, openWarGames: 0 });

  const openGames = one<OpenGamesRow>(
    db,
    `SELECT COUNT(*) AS total FROM war_games
      WHERE project_key = ? AND status IN ('open', 'drilled') AND post = ? AND aspect = ?`,
    [projectKey, weakest.post, weakest.aspect],
  );
  return attentionFor({ board, openWarGames: openGames?.total ?? 0 });
};
