export const NODE_KINDS = [
  "entry",
  "caller",
  "consumer",
  "handler",
  "shared-caller",
  "external",
  "procedure",
  "hook",
  "route",
  "component",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export type ClosureNode = {
  id: string;
  kind: NodeKind;
  path: string;
  reachedVia: string;
  hops: number;
  symbol?: string;
};

export const EDGE_KINDS = [
  "caller",
  "mutation-consumer",
  "event-handler",
  "shared-caller",
  "external",
  "router",
  "hook",
  "component",
  "route",
] as const;

export type EdgeKind = (typeof EDGE_KINDS)[number];

export type ClosureEdge = {
  from: string;
  to: string;
  kind: EdgeKind;
  detail: string;
};

export const RESOLUTION_STATES = [
  "unresolved",
  "existing-test",
  "new-case",
  "waived",
] as const;

export type ResolutionState = (typeof RESOLUTION_STATES)[number];

export type ExistingTestResolution = {
  kind: "existing-test";
  testFile: string;
  testName: string;
  verifiedBy?: string;
};

export type NewCaseResolution = {
  kind: "new-case";
  testRef?: string;
};

export type WaivedResolution = {
  kind: "waived";
  reason: string;
  signedBy: string;
};

export type Resolution =
  | ExistingTestResolution
  | NewCaseResolution
  | WaivedResolution;

export type UnresolvedNode = {
  nodeId: string;
  kind: string;
};
