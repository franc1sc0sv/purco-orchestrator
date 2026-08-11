import type { RankRow } from "test-forge-contracts/board";

export type AttentionBasis =
  | { reason: string }
  | RankRow
  | (RankRow & { openWarGames: number });

export type Attention = {
  sentence: string;
  basis: AttentionBasis;
};

export type AttentionInput = {
  board: readonly RankRow[];
  openWarGames: number;
};

export const weakestPost = (board: readonly RankRow[]): RankRow | undefined =>
  board.reduce<RankRow | undefined>(
    (weakest, row) =>
      weakest === undefined || row.score <= weakest.score ? row : weakest,
    undefined
  );

export const attentionFor = ({
  board,
  openWarGames,
}: AttentionInput): Attention => {
  const weakest = weakestPost(board);

  if (weakest === undefined) {
    return {
      sentence:
        "Run /test-rules to seed the doctrine: the board holds no scored outcomes yet.",
      basis: { reason: "no scored outcomes" },
    };
  }

  if (weakest.state === "HOLDING") {
    return {
      sentence: `Every post holds at 85 or above, so run /test-forge on the next unit of work; ${weakest.callsign} at ${weakest.post} is the closest to slipping at ${weakest.score}.`,
      basis: weakest,
    };
  }

  if (openWarGames > 0) {
    return {
      sentence: `Run /test-replay --aspect ${
        weakest.aspect || "all"
      } to drill the ${openWarGames} open War Games behind ${weakest.post} at ${
        weakest.score
      } (${weakest.state}).`,
      basis: { ...weakest, openWarGames },
    };
  }

  const target = weakest.aspect ? ` --aspect ${weakest.aspect}` : "";
  return {
    sentence: `Run /test-rules${target} because ${weakest.post} scores ${weakest.score} (${weakest.state}, trend ${weakest.trend}); the doctrine for that aspect is what is failing, not ${weakest.callsign}.`,
    basis: weakest,
  };
};
