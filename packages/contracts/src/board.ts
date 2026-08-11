export const RANKS = [
  "Inheritor",
  "Field Marshal",
  "Captain",
  "Warrant Officer",
  "Sergeant",
  "Corporal",
  "Recruit",
] as const;

export type Rank = (typeof RANKS)[number];

export const BOARD_STATES = {
  HOLDING: "HOLDING",
  WATCH: "WATCH",
  NEEDS_ATTENTION: "NEEDS ATTENTION",
  STAND_DOWN: "STAND DOWN",
} as const;

export type BoardState = (typeof BOARD_STATES)[keyof typeof BOARD_STATES];

export const TRENDS = ["up", "flat", "down"] as const;

export type Trend = (typeof TRENDS)[number];

export const SCORED_EVENT_KINDS = [
  "verdict-upheld",
  "finding-valid",
  "defect-confirmed",
  "citation-verified",
  "mutant-killed",
  "equivalence-upheld",
  "rule-accepted",
  "test-valuable",
  "gate-passed",
  "replay-caught",
  "closure-node-resolved",
  "verdict-overturned",
  "false-positive",
  "false-negative",
  "citation-fabricated",
  "mutant-survived",
  "equivalence-refuted",
  "rule-rejected",
  "test-pruned",
  "flake-introduced",
  "gate-failed",
  "replay-missed",
  "stalled-pass",
  "blocked-on-ambiguity",
] as const;

export type ScoredEventKind = (typeof SCORED_EVENT_KINDS)[number];

export type OutcomePolarity = "positive" | "negative" | "unscored";

export type Outcome = {
  outcomeId: number;
  runId: number | null;
  callsign: string;
  post: string;
  aspect: string;
  eventKind: string;
  weight: number;
  createdAt: string;
};

export type RankRow = {
  callsign: string;
  post: string;
  aspect: string;
  score: number;
  state: BoardState;
  rank: Rank;
  trend: Trend;
  outcomes: number;
  windowSize: number;
  unscoredEvents: number;
};

export const WAR_GAME_STATUSES = [
  "open",
  "drilled",
  "passing",
  "retired",
] as const;

export type WarGameStatus = (typeof WAR_GAME_STATUSES)[number];

export const REPLAY_RESULTS = ["caught", "missed", "error", "skipped"] as const;

export type ReplayResult = (typeof REPLAY_RESULTS)[number];

export type Replay = {
  result: ReplayResult;
  note: string;
  createdAt: string;
};

export type WarGameScenario = {
  scenarioId: number;
  scenarioKey: string;
  squad: string;
  post: string;
  aspect: string;
  engagement: Record<string, unknown>;
  whatHappened: string;
  whatWasCorrect: string;
  rootCause: string;
  status: WarGameStatus;
  createdAt: string;
  lastReplay: Replay | null;
};

export const isScoredEventKind = (value: unknown): value is ScoredEventKind =>
  typeof value === "string" &&
  SCORED_EVENT_KINDS.includes(value as ScoredEventKind);
