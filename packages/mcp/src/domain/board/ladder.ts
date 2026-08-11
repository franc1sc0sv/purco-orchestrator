import type { Rank } from "test-forge-contracts/board";

export type Rung = {
  rank: Rank;
  minimumScore: number;
  minimumOutcomes: number;
  unlocks: string;
};

export type RankMovement = "promoted" | "held" | "demoted";

export const LADDER: readonly Rung[] = [
  {
    rank: "Inheritor",
    minimumScore: 97,
    minimumOutcomes: 40,
    unlocks: "carries the doctrine forward and seeds a new project's codex",
  },
  {
    rank: "Field Marshal",
    minimumScore: 93,
    minimumOutcomes: 25,
    unlocks: "proposes doctrine rules for human acceptance",
  },
  {
    rank: "Captain",
    minimumScore: 88,
    minimumOutcomes: 15,
    unlocks: "adjudicates the findings of other posts in its aspect",
  },
  {
    rank: "Warrant Officer",
    minimumScore: 80,
    minimumOutcomes: 8,
    unlocks: "signs the gate verdict for its aspect",
  },
  {
    rank: "Sergeant",
    minimumScore: 70,
    minimumOutcomes: 4,
    unlocks: "adjudicates its own findings inside one aspect",
  },
  {
    rank: "Corporal",
    minimumScore: 55,
    minimumOutcomes: 1,
    unlocks: "works a post without a second pair of eyes on every draft",
  },
  {
    rank: "Recruit",
    minimumScore: 0,
    minimumOutcomes: 0,
    unlocks: "drafts under review; every verdict is checked by another post",
  },
];

export const LOWEST_RANK: Rank = "Recruit";

export const rungOf = (rank: Rank): Rung | undefined =>
  LADDER.find((rung) => rung.rank === rank);

export const unlockedBy = (rank: Rank): string => rungOf(rank)?.unlocks ?? "";

export const rankOf = (score: number, outcomeCount: number): Rank => {
  for (const rung of LADDER) {
    if (score >= rung.minimumScore && outcomeCount >= rung.minimumOutcomes)
      return rung.rank;
  }
  return LOWEST_RANK;
};

export const rankIndex = (rank: Rank): number =>
  LADDER.findIndex((rung) => rung.rank === rank);

export const movementBetween = (
  previous: Rank | null,
  next: Rank
): RankMovement => {
  if (previous === null || previous === next) return "held";
  return rankIndex(next) < rankIndex(previous) ? "promoted" : "demoted";
};
