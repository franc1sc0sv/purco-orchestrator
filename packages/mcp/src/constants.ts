import { join, resolve } from "node:path";
import type { Rank } from "test-forge-contracts/board";

export const SERVER_NAME = "test-forge-mcp-server";

export const SERVER_VERSION = "1.0.0";

export const CHARACTER_LIMIT = 25000;

export const TESTING_ROOT = resolve(import.meta.dirname, "..", "..", "..");

export const DB_PATH = join(TESTING_ROOT, "data", "forge.db");

export const RESOURCES_PATH = join(TESTING_ROOT, "resources");

export const AGENTS_PATH = join(RESOURCES_PATH, "agents");

export const DOCTRINE_PATH = join(RESOURCES_PATH, "doctrine");

export const CANARIES_PATH = join(RESOURCES_PATH, "canaries");

export const TEMPLATES_PATH = join(RESOURCES_PATH, "templates");

export type RankRung = {
  rank: Rank;
  minimumScore: number;
  minimumOutcomes: number;
};

export const RANK_LADDER: readonly RankRung[] = [
  { rank: "Inheritor", minimumScore: 97, minimumOutcomes: 40 },
  { rank: "Field Marshal", minimumScore: 93, minimumOutcomes: 25 },
  { rank: "Captain", minimumScore: 88, minimumOutcomes: 15 },
  { rank: "Warrant Officer", minimumScore: 80, minimumOutcomes: 8 },
  { rank: "Sergeant", minimumScore: 70, minimumOutcomes: 4 },
  { rank: "Corporal", minimumScore: 55, minimumOutcomes: 1 },
  { rank: "Recruit", minimumScore: 0, minimumOutcomes: 0 },
];

export const LOWEST_RANK: Rank = "Recruit";
