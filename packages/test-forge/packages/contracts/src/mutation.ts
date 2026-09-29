export const MUTATION_OPERATORS = [
  "boundary-swap",
  "condition-flip",
  "guard-removal",
  "empty-result",
  "argument-swap",
  "await-removal",
  "enum-shift",
  "date-shift",
] as const;

export type MutationOperator = (typeof MUTATION_OPERATORS)[number];

export const MUTANT_OUTCOMES = [
  "pending",
  "killed",
  "survived",
  "equivalent-claimed",
  "equivalent-signed",
  "refuted",
  "error",
  "timeout",
  "unviable",
] as const;

export type MutantOutcome = (typeof MUTANT_OUTCOMES)[number];

export type Mutant = {
  file: string;
  line: number;
  operator: MutationOperator;
  before: string;
  after: string;
  id?: number;
};

export type MutantRow = {
  id: number;
  file_path: string;
  line: number;
  operator: MutationOperator;
  before_text: string;
  after_text: string;
  outcome: MutantOutcome;
};

export type PendingMutantRow = {
  id: number;
  file_path: string;
  line: number;
  operator: MutationOperator;
};

export type Kill = {
  file: string;
  name: string;
};

export type KillAttribution = {
  testFile: string;
  testName: string;
  mutantIds: number[];
  uniqueMutantIds: number[] | null;
  kills: number;
  uniqueKills: number | null;
};

export type EquivalenceClaim = {
  id: number;
  mutantId: number;
  claimedBy: string;
  argument: string;
  refutedBy: string | null;
  refutation: string | null;
  upheld: boolean | null;
  signedBy: string | null;
  createdAt: string;
};

export const isMutationOperator = (value: unknown): value is MutationOperator =>
  typeof value === "string" &&
  MUTATION_OPERATORS.includes(value as MutationOperator);
