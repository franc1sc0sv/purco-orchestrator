import { PREDICATE_KEY_OF } from "../../domain/gates/gates.ts";
import type {
  CoverageCellState,
  FindingStatus,
  RecordedVerdict,
  SubjectKind,
  UnitState,
  WaiverKind,
} from "../../infrastructure/db/rows.ts";
import { PREDICATE_IDS } from "test-forge-contracts/gates";
import type { DoneVector, PredicateKey } from "test-forge-contracts/gates";

export const PREDICATE_KEYS: readonly PredicateKey[] = PREDICATE_IDS.map(
  (id) => PREDICATE_KEY_OF[id]
);

export const UNIT_STATES: readonly UnitState[] = [
  "assigned",
  "drafted",
  "reviewed",
  "revised",
  "accepted",
  "abandoned",
];

export const FINDING_STATUSES: readonly FindingStatus[] = [
  "open",
  "fixed",
  "waived",
  "confirmed-defect",
  "confirmed-but-known",
  "rejected",
  "superseded",
];

export const SUBJECT_KINDS: readonly SubjectKind[] = [
  "file",
  "test",
  "finding",
  "mutant",
  "matrix-cell",
  "radius-node",
  "focus-item",
];

export const RECORDED_VERDICTS: readonly RecordedVerdict[] = [
  "pass",
  "violation",
  "not-applicable",
  "confirmed-defect",
  "confirmed-but-known",
  "not-a-defect",
];

export type MatrixCellState = Exclude<CoverageCellState, "waived">;

export const MATRIX_CELL_STATES: readonly MatrixCellState[] = [
  "empty",
  "covered",
  "not-applicable",
];

export const WAIVER_KINDS: readonly WaiverKind[] = [
  "matrix-cell",
  "radius-node",
  "focus-line",
  "rule",
  "mutant",
  "finding",
  "test-value",
];

export const requireEnum = <TValue extends string>(
  value: TValue,
  allowed: readonly TValue[],
  field: string
): TValue => {
  if (!allowed.includes(value)) {
    throw new Error(
      `${field} must be one of ${allowed.join(", ")} but was "${value}"`
    );
  }
  return value;
};

export const bit = (value: boolean): number => (value ? 1 : 0);

const flag = (source: Record<string, unknown>, key: PredicateKey): boolean => {
  const value = source[key] ?? source[key.toUpperCase()];
  return value === true || value === 1 || value === "true";
};

export const normalisePredicates = (
  predicates: Record<string, unknown> | undefined
): DoneVector => {
  const source = predicates ?? {};
  return {
    d1: flag(source, "d1"),
    d2: flag(source, "d2"),
    d3: flag(source, "d3"),
    d4: flag(source, "d4"),
    d5: flag(source, "d5"),
    d6: flag(source, "d6"),
    d7: flag(source, "d7"),
    d8: flag(source, "d8"),
    d9: flag(source, "d9"),
    d10: flag(source, "d10"),
  };
};
