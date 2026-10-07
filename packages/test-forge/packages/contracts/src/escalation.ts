export const ESCALATION_SUBJECT_KINDS = [
  "rule",
  "file",
  "test",
  "finding",
  "mutant",
  "matrix-cell",
  "radius-node",
  "focus-item",
  "assignment",
  "instruction",
] as const;

export type EscalationSubjectKind = (typeof ESCALATION_SUBJECT_KINDS)[number];

export const ESCALATION_STATES = ["open", "resolved"] as const;

export type EscalationState = (typeof ESCALATION_STATES)[number];

export const ESCALATION_RESOLUTIONS = [
  "fixed",
  "rule-changed",
  "waived",
  "rejected",
] as const;

export type EscalationResolution = (typeof ESCALATION_RESOLUTIONS)[number];

export type EscalationClosure = {
  resolution: EscalationResolution;
  resolvedBy: string;
  reason: string;
  resolvedAt: string;
};

export type OpenEscalation = {
  escalationKey: string;
  raisedBy: string;
  post: string;
  subjectKind: EscalationSubjectKind;
  subjectRef: string;
  claim: string;
};


const KNOWN_RESOLUTIONS: ReadonlySet<string> = new Set<string>(
  ESCALATION_RESOLUTIONS
);

export const isEscalationResolution = (
  value: unknown
): value is EscalationResolution =>
  typeof value === "string" && KNOWN_RESOLUTIONS.has(value);
