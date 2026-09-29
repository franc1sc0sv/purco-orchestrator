import type {
  DoneVector,
  GateFailure,
  GateId,
  GateResult,
  GateStatus,
  PredicateId,
  PredicateKey,
  PredicateReport,
  PredicateResult,
  WorkItem,
} from "test-forge-contracts/gates";
import { PREDICATE_IDS, PREDICATE_NAMES } from "test-forge-contracts/gates";

export type GateDefinition = {
  gate: GateId;
  name: string;
  predicates: readonly PredicateId[];
};

export type PredicateTable = Record<PredicateKey, PredicateResult>;

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

export const GATES: readonly GateDefinition[] = [
  { gate: 1, name: "syntax and static", predicates: ["D1"] },
  { gate: 2, name: "flake probe", predicates: ["D3"] },
  { gate: 3, name: "aspect conformance and focus", predicates: ["D2", "D9"] },
  { gate: 4, name: "matrix and closure", predicates: ["D7", "D8"] },
  { gate: 5, name: "finding verification", predicates: ["D4"] },
  { gate: 6, name: "mutation and equivalence", predicates: ["D5"] },
  { gate: 7, name: "test value attribution", predicates: ["D6"] },
  { gate: 8, name: "open escalations", predicates: ["D10"] },
];

export const gateById = (gate: number): GateDefinition | null =>
  GATES.find((definition) => definition.gate === gate) ?? null;

export const gateOfPredicate = (
  predicate: PredicateId
): GateDefinition | null =>
  GATES.find((definition) => definition.predicates.includes(predicate)) ?? null;

const resultOf = (table: PredicateTable, id: PredicateId): PredicateResult =>
  table[PREDICATE_KEY_OF[id]];

export const doneVectorOf = (table: PredicateTable): DoneVector => ({
  d1: table.d1.value,
  d2: table.d2.value,
  d3: table.d3.value,
  d4: table.d4.value,
  d5: table.d5.value,
  d6: table.d6.value,
  d7: table.d7.value,
  d8: table.d8.value,
  d9: table.d9.value,
  d10: table.d10.value,
});

export const gateStatusOf = (
  definition: GateDefinition,
  table: PredicateTable
): GateStatus =>
  definition.predicates.every((id) => resultOf(table, id).value)
    ? "pass"
    : "fail";

export const predicateReports = (
  definition: GateDefinition,
  table: PredicateTable
): PredicateReport[] =>
  definition.predicates.map((id) => {
    const result = resultOf(table, id);
    return {
      predicate: id,
      name: PREDICATE_NAMES[id],
      value: result.value,
      indeterminate: result.indeterminate,
      checked: result.checked,
      passed: result.passed,
      failed: result.failed,
    };
  });

export const gateRows = (table: PredicateTable): GateResult[] =>
  GATES.map((definition) => {
    const parts = definition.predicates.map((id) => resultOf(table, id));
    const failed: GateFailure[] = definition.predicates.flatMap((id) =>
      resultOf(table, id).failed.map((item) => ({ predicate: id, ...item }))
    );
    return {
      gate: definition.gate,
      name: definition.name,
      status: gateStatusOf(definition, table),
      evidence: {
        predicates: definition.predicates.map(
          (id) => `${id} ${PREDICATE_NAMES[id]}`
        ),
        checked: parts.reduce((sum, part) => sum + part.checked.length, 0),
        passed: parts.reduce((sum, part) => sum + part.passed.length, 0),
        failed: failed.length,
        firstFailures: failed.slice(0, 5),
      },
    };
  });

export const workList = (table: PredicateTable): WorkItem[] =>
  PREDICATE_IDS.flatMap((id) => {
    const result = resultOf(table, id);
    const definition = gateOfPredicate(id);
    if (result.value || definition === null) return [];
    return result.failed.map((item) => ({
      predicate: id,
      predicateName: PREDICATE_NAMES[id],
      gate: definition.gate,
      gateName: definition.name,
      ref: item.ref,
      reason: item.reason,
      location: item.location,
    }));
  });
