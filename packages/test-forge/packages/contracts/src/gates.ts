export const PREDICATE_IDS = [
  "D1",
  "D2",
  "D3",
  "D4",
  "D5",
  "D6",
  "D7",
  "D8",
  "D9",
  "D10",
] as const;

export type PredicateId = (typeof PREDICATE_IDS)[number];

export type PredicateKey = Lowercase<PredicateId>;

export type DoneVector = {
  [K in PredicateKey]: boolean;
};

export const PREDICATE_NAMES = {
  D1: "SYNTAX",
  D2: "CONFORMANCE",
  D3: "STABLE",
  D4: "VERIFIED",
  D5: "MUTATION",
  D6: "VALUE",
  D7: "COMPLETE",
  D8: "RADIUS",
  D9: "FOCUS",
  D10: "ESCALATION",
} as const;

export type PredicateName = (typeof PREDICATE_NAMES)[PredicateId];

export const GATE_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type GateId = (typeof GATE_IDS)[number];

export type GateStatus = "pass" | "fail";

export type FailedSubject = {
  ref: string;
  reason: string;
  location: string;
};

export type GateFailure = FailedSubject & {
  predicate: PredicateId;
};

export type PredicateResult = {
  value: boolean;
  indeterminate: string | null;
  checked: string[];
  passed: string[];
  failed: FailedSubject[];
};

export type PredicateReport = {
  predicate: PredicateId;
  name: PredicateName;
  value: boolean;
  indeterminate: string | null;
  checked: string[];
  passed: string[];
  failed: FailedSubject[];
};

export type GateEvidence = {
  predicates: string[];
  checked: number;
  passed: number;
  failed: number;
  firstFailures: GateFailure[];
};

export type GateResult = {
  gate: GateId;
  name: string;
  status: GateStatus;
  evidence: GateEvidence;
};

export type WorkItem = {
  predicate: PredicateId;
  predicateName: PredicateName;
  gate: GateId;
  gateName: string;
  ref: string;
  reason: string;
  location: string;
};

export const EXIT_KINDS = ["DONE", "BLOCKED", "STALLED"] as const;

export type ExitKind = (typeof EXIT_KINDS)[number];
