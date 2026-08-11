import type {
  Resolution,
  ResolutionState,
  UnresolvedNode,
} from "test-forge-contracts/closure";

export const DEFAULT_CITATION_VERIFIER = "roland:citation-check";

export type ResolutionRejection = {
  resolved: false;
  verified: false;
  reason: string;
  testNamesInFile?: string[];
};

export type ExistingTestAcceptance = {
  resolved: true;
  verified: true;
  citation: string;
};

export type NewCaseAcceptance = {
  resolved: true;
  verified: false;
  plannedTest: string;
};

export type WaiverAcceptance = {
  resolved: true;
  verified: false;
  waivedBy: string;
};

export type ResolutionOutcome =
  | ResolutionRejection
  | ExistingTestAcceptance
  | NewCaseAcceptance
  | WaiverAcceptance;

export type NodeResolutionRecord = {
  nodeId: string;
  kind: string;
  state: ResolutionState;
};

export type UnresolvedSummary = {
  unresolved: UnresolvedNode[];
  unresolvedCount: number;
  totalNodes: number;
  d8: boolean;
};

export const citationOf = (testFile: string, testName: string): string =>
  `${testFile}::${testName}`;

export const citationPresent = (
  testNames: Iterable<string>,
  citedName: string
): boolean =>
  [...testNames].some((name) => name === citedName || name.includes(citedName));

export const verifierOf = (verifiedBy: string | undefined): string =>
  verifiedBy ?? DEFAULT_CITATION_VERIFIER;

export const rejectResolution = (reason: string): ResolutionRejection => ({
  resolved: false,
  verified: false,
  reason,
});

export const rejectCitation = (
  testFile: string,
  testName: string,
  testNamesInFile: Iterable<string>
): ResolutionRejection => ({
  resolved: false,
  verified: false,
  reason: `cited test not found in ${testFile}: ${testName}`,
  testNamesInFile: [...testNamesInFile],
});

export const rejectMissingFile = (testFile: string): ResolutionRejection =>
  rejectResolution(`cited file does not exist: ${testFile}`);

export const rejectUnknownKind = (kind: string): ResolutionRejection =>
  rejectResolution(`unknown resolution kind: ${kind}`);

export const validateResolution = (
  resolution: Resolution
): ResolutionRejection | null => {
  if (resolution.kind === "existing-test") {
    if (!resolution.testFile || !resolution.testName)
      return rejectResolution("existing-test needs both testFile and testName");
    return null;
  }
  if (resolution.kind === "waived") {
    if (!resolution.reason || !resolution.signedBy)
      return rejectResolution("a waiver needs both reason and signedBy");
    return null;
  }
  return null;
};

export const acceptExistingTest = (
  testFile: string,
  testName: string
): ExistingTestAcceptance => ({
  resolved: true,
  verified: true,
  citation: citationOf(testFile, testName),
});

export const acceptNewCase = (
  testRef: string | undefined
): NewCaseAcceptance => ({
  resolved: true,
  verified: false,
  plannedTest: testRef ?? "",
});

export const acceptWaiver = (signedBy: string): WaiverAcceptance => ({
  resolved: true,
  verified: false,
  waivedBy: signedBy,
});

export const stateOfResolution = (resolution: Resolution): ResolutionState =>
  resolution.kind;

export const isResolved = (state: ResolutionState): boolean =>
  state !== "unresolved";

const byKindThenId = (left: UnresolvedNode, right: UnresolvedNode): number => {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  if (left.nodeId === right.nodeId) return 0;
  return left.nodeId < right.nodeId ? -1 : 1;
};

export const selectUnresolved = (
  records: readonly NodeResolutionRecord[]
): UnresolvedNode[] =>
  records
    .filter((record) => !isResolved(record.state))
    .map((record) => ({ nodeId: record.nodeId, kind: record.kind }))
    .sort(byKindThenId);

export const d8Holds = (unresolvedCount: number): boolean =>
  unresolvedCount === 0;

export const unresolvedSummary = (
  records: readonly NodeResolutionRecord[],
  totalNodes: number
): UnresolvedSummary => {
  const unresolved = selectUnresolved(records);
  return {
    unresolved,
    unresolvedCount: unresolved.length,
    totalNodes,
    d8: d8Holds(unresolved.length),
  };
};
