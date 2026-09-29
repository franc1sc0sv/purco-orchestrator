import { PREDICATE_IDS } from "test-forge-contracts/gates";
import type {
  DoneVector,
  GateId,
  PredicateId,
  PredicateKey,
  PredicateName,
  WorkItem,
} from "test-forge-contracts/gates";

export const PREDICATE_KEY_OF: Record<PredicateId, PredicateKey> = {
  D1: "d1",
  D2: "d2",
  D3: "d3",
  D4: "d4",
  D5: "d5",
  D6: "d6",
  D7: "d7",
  D8: "d8",
  D9: "d9",
  D10: "d10",
};

export type WorkRef = {
  ref: string;
  location: string;
};

export type WorkGroup = {
  predicate: PredicateId;
  predicateName: PredicateName;
  gate: GateId;
  gateName: string;
  reason: string;
  refs: WorkRef[];
};

export type CycleAssignment = {
  failing: PredicateId[];
  allTrue: boolean;
  groups: WorkGroup[];
};

const failingPredicates = (vector: DoneVector): PredicateId[] =>
  PREDICATE_IDS.filter((id) => !vector[PREDICATE_KEY_OF[id]]);

const groupKey = (item: WorkItem): string =>
  `${item.predicate}::${item.reason}`;

const groupWork = (work: readonly WorkItem[]): WorkGroup[] => {
  const groups = new Map<string, WorkGroup>();

  for (const item of work) {
    const reference: WorkRef = { ref: item.ref, location: item.location };
    const existing = groups.get(groupKey(item));
    if (existing !== undefined) {
      existing.refs.push(reference);
      continue;
    }
    groups.set(groupKey(item), {
      predicate: item.predicate,
      predicateName: item.predicateName,
      gate: item.gate,
      gateName: item.gateName,
      reason: item.reason,
      refs: [reference],
    });
  }

  return [...groups.values()];
};

export const planCycle = (
  vector: DoneVector,
  work: readonly WorkItem[]
): CycleAssignment => {
  const failing = failingPredicates(vector);
  const open = new Set<PredicateId>(failing);

  return {
    failing,
    allTrue: failing.length === 0,
    groups: groupWork(work.filter((item) => open.has(item.predicate))),
  };
};
