export const OUTCOME_KINDS = [
  "delivered",
  "blocked",
  "out-of-scope",
  "disputed",
  "failed",
] as const;

export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export type EvidenceCitation = {
  location: string;
  observed: string;
};

export type Evidence = readonly [EvidenceCitation, ...EvidenceCitation[]];

export type DeliveredOutcome = {
  kind: "delivered";
  summary: string;
  produced: readonly string[];
};

export type BlockedOutcome = {
  kind: "blocked";
  summary: string;
  escalationKey: string;
  evidence: Evidence;
};

export type OutOfScopeOutcome = {
  kind: "out-of-scope";
  summary: string;
  belongsTo: string;
  evidence: Evidence;
};

export type DisputedOutcome = {
  kind: "disputed";
  summary: string;
  escalationKey: string;
  disputedInstruction: string;
  evidence: Evidence;
};

export type FailedOutcome = {
  kind: "failed";
  summary: string;
  attempted: readonly string[];
  evidence: Evidence;
};

export type Outcome =
  | DeliveredOutcome
  | BlockedOutcome
  | OutOfScopeOutcome
  | DisputedOutcome
  | FailedOutcome;

export const escalationKeyOf = (outcome: Outcome): string | null =>
  outcome.kind === "blocked" || outcome.kind === "disputed"
    ? outcome.escalationKey
    : null;
