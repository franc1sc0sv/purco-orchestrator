import type {
  BoardState,
  OutcomePolarity,
  RankRow,
  ScoredEventKind,
  Trend,
} from "test-forge-contracts/board";

export const DEFAULT_WINDOW = 40;

export type EventWeight = {
  polarity: 1 | -1;
  weight: number;
};

export type BoardOutcome = {
  callsign: string;
  post: string;
  aspect: string;
  eventKind: string;
  weight: number;
};

export type ScoreBreakdown = {
  score: number | null;
  positive: number;
  negative: number;
  unscored: number;
};

export type ScoredPost = Omit<RankRow, "rank">;

const EVENT_WEIGHTS: Record<ScoredEventKind, EventWeight> = {
  "verdict-upheld": { polarity: 1, weight: 1 },
  "finding-valid": { polarity: 1, weight: 1.5 },
  "defect-confirmed": { polarity: 1, weight: 2 },
  "citation-verified": { polarity: 1, weight: 1 },
  "mutant-killed": { polarity: 1, weight: 1 },
  "equivalence-upheld": { polarity: 1, weight: 1.5 },
  "rule-accepted": { polarity: 1, weight: 2 },
  "test-valuable": { polarity: 1, weight: 1 },
  "gate-passed": { polarity: 1, weight: 0.5 },
  "replay-caught": { polarity: 1, weight: 2 },
  "closure-node-resolved": { polarity: 1, weight: 0.5 },
  "verdict-overturned": { polarity: -1, weight: 2 },
  "false-positive": { polarity: -1, weight: 1.5 },
  "false-negative": { polarity: -1, weight: 2.5 },
  "citation-fabricated": { polarity: -1, weight: 3 },
  "mutant-survived": { polarity: -1, weight: 1 },
  "equivalence-refuted": { polarity: -1, weight: 2 },
  "rule-rejected": { polarity: -1, weight: 1.5 },
  "test-pruned": { polarity: -1, weight: 1.5 },
  "flake-introduced": { polarity: -1, weight: 2.5 },
  "gate-failed": { polarity: -1, weight: 0.5 },
  "replay-missed": { polarity: -1, weight: 3 },
  "stalled-pass": { polarity: -1, weight: 2 },
  "blocked-on-ambiguity": { polarity: -1, weight: 1 },
};

const WEIGHT_BY_EVENT: ReadonlyMap<string, EventWeight> = new Map(
  Object.entries(EVENT_WEIGHTS)
);

export const KNOWN_EVENT_KINDS: readonly string[] = [...WEIGHT_BY_EVENT.keys()];

export const weightOf = (eventKind: string): EventWeight | undefined =>
  WEIGHT_BY_EVENT.get(eventKind);

export const isScored = (eventKind: string): boolean =>
  WEIGHT_BY_EVENT.has(eventKind);

export const polarityOf = (eventKind: string): OutcomePolarity => {
  const definition = weightOf(eventKind);
  if (!definition) return "unscored";
  return definition.polarity > 0 ? "positive" : "negative";
};

export const scoreOf = (
  outcomes: readonly Pick<BoardOutcome, "eventKind" | "weight">[]
): ScoreBreakdown => {
  let positive = 0;
  let negative = 0;
  let unscored = 0;
  for (const outcome of outcomes) {
    const definition = weightOf(outcome.eventKind);
    if (!definition) {
      unscored += 1;
      continue;
    }
    const contribution = definition.weight * outcome.weight;
    if (definition.polarity > 0) positive += contribution;
    else negative += contribution;
  }
  const total = positive + negative;
  return {
    score: total === 0 ? null : Math.round((1000 * positive) / total) / 10,
    positive,
    negative,
    unscored,
  };
};

export const trendOf = (
  outcomes: readonly Pick<BoardOutcome, "eventKind" | "weight">[]
): Trend => {
  if (outcomes.length < 4) return "flat";
  const split = Math.floor(outcomes.length / 2);
  const older = scoreOf(outcomes.slice(0, split)).score;
  const newer = scoreOf(outcomes.slice(split)).score;
  if (older === null || newer === null) return "flat";
  if (newer - older > 5) return "up";
  if (older - newer > 5) return "down";
  return "flat";
};

export const stateOf = (score: number): BoardState => {
  if (score >= 85) return "HOLDING";
  if (score >= 70) return "WATCH";
  if (score >= 50) return "NEEDS ATTENTION";
  return "STAND DOWN";
};

export const windowOf = <Item>(
  outcomes: readonly Item[],
  size: number
): Item[] => outcomes.slice(-size);

export const scoreBoard = (
  outcomes: readonly BoardOutcome[],
  windowSize: number = DEFAULT_WINDOW
): ScoredPost[] => {
  const groups = new Map<string, BoardOutcome[]>();
  for (const outcome of outcomes) {
    const key = `${outcome.callsign}|${outcome.post}|${outcome.aspect}`;
    const existing = groups.get(key);
    if (existing) existing.push(outcome);
    else groups.set(key, [outcome]);
  }

  const posts: ScoredPost[] = [];
  for (const all of groups.values()) {
    const recent = windowOf(all, windowSize);
    const first = recent[0];
    if (first === undefined) continue;
    const scored = scoreOf(recent);
    if (scored.score === null) continue;
    posts.push({
      callsign: first.callsign,
      post: first.post,
      aspect: first.aspect,
      score: scored.score,
      state: stateOf(scored.score),
      trend: trendOf(recent),
      outcomes: recent.length - scored.unscored,
      windowSize,
      unscoredEvents: scored.unscored,
    });
  }

  return posts.sort((left, right) => right.score - left.score);
};

export const countByState = (
  posts: readonly Pick<ScoredPost, "state">[]
): Partial<Record<BoardState, number>> => {
  const counts: Partial<Record<BoardState, number>> = {};
  for (const post of posts) counts[post.state] = (counts[post.state] ?? 0) + 1;
  return counts;
};
