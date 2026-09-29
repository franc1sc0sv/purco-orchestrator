import { PREDICATE_KEY_OF } from "./gates.ts";
import type {
  DoneVector,
  ExitKind,
  PredicateId,
} from "test-forge-contracts/gates";
import { PREDICATE_IDS } from "test-forge-contracts/gates";

export type OpenBlock = {
  predicate: string;
  reason: string;
  refs: readonly string[];
};

export type ExitDecision = {
  kind: ExitKind;
  reason: string;
  failing: PredicateId[];
  blocks: readonly OpenBlock[];
  unmovedVector: DoneVector | null;
};

export const failingPredicates = (vector: DoneVector): PredicateId[] =>
  PREDICATE_IDS.filter((id) => !vector[PREDICATE_KEY_OF[id]]);

export const sameVector = (left: DoneVector, right: DoneVector): boolean =>
  PREDICATE_IDS.every(
    (id) => left[PREDICATE_KEY_OF[id]] === right[PREDICATE_KEY_OF[id]]
  );

const blockedReason = (
  failing: readonly PredicateId[],
  blocks: readonly OpenBlock[]
): string =>
  blocks.length > 0
    ? blocks.map((block) => `${block.predicate}: ${block.reason}`).join(" ")
    : `${failing.join(", ")} stayed false with no open block named.`;

export const decideExit = ({
  vector,
  previousVector,
  blocks,
}: {
  vector: DoneVector;
  previousVector: DoneVector | null;
  blocks: readonly OpenBlock[];
}): ExitDecision => {
  const failing = failingPredicates(vector);
  if (failing.length === 0 && blocks.length === 0) {
    return {
      kind: "DONE",
      reason: "All ten predicates are true and no block is open.",
      failing: [],
      blocks: [],
      unmovedVector: null,
    };
  }
  if (previousVector !== null && sameVector(vector, previousVector)) {
    return {
      kind: "STALLED",
      reason: `The done vector is identical to the previous pass: ${failing.join(
        ", "
      )} did not move.`,
      failing,
      blocks,
      unmovedVector: vector,
    };
  }
  return {
    kind: "BLOCKED",
    reason: blockedReason(failing, blocks),
    failing,
    blocks,
    unmovedVector: null,
  };
};
