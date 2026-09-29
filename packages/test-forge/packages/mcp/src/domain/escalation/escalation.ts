import type {
  EscalationClosure,
  OpenEscalation,
  PostOverride,
} from "test-forge-contracts/escalation";
import {
  ESCALATION_RESOLUTIONS,
  isEscalationResolution,
} from "test-forge-contracts/escalation";
import type { Evidence, EvidenceCitation } from "test-forge-contracts/outcome";

export const requireText = (value: string, field: string): string => {
  const text = value.trim();
  if (text.length === 0) {
    throw new Error(`${field} must be written text but was empty`);
  }
  return text;
};

export const asEvidence = (
  citations: readonly EvidenceCitation[]
): Evidence => {
  const [first, ...rest] = citations;
  if (first === undefined) {
    throw new Error(
      "a non-delivered outcome must carry at least one evidence citation"
    );
  }
  return [first, ...rest];
};

export type ClosureRequest = {
  resolution: string;
  resolvedBy: string;
  reason: string;
  resolvedAt: string;
};

export const closureOf = ({
  resolution,
  resolvedBy,
  reason,
  resolvedAt,
}: ClosureRequest): EscalationClosure => {
  if (!isEscalationResolution(resolution)) {
    throw new Error(
      `resolution must be one of ${ESCALATION_RESOLUTIONS.join(
        ", "
      )} but was "${resolution}"`
    );
  }
  return {
    resolution,
    resolvedBy: requireText(resolvedBy, "resolvedBy"),
    reason: requireText(
      reason,
      "reason: an escalation cannot be closed, waived or rejected without one"
    ),
    resolvedAt,
  };
};

export type PostRequest = {
  suggestedPost: string;
  assignedPost: string | undefined;
  override: PostOverride | undefined;
};

export type PostDecision = {
  suggestedPost: string;
  assignedPost: string;
  overriddenBy: string | null;
  overrideReason: string | null;
};

export const postDecisionOf = ({
  suggestedPost,
  assignedPost,
  override,
}: PostRequest): PostDecision => {
  const suggested = requireText(suggestedPost, "suggestedPost");
  const assigned =
    assignedPost === undefined
      ? suggested
      : requireText(assignedPost, "assignedPost");
  if (assigned === suggested) {
    return {
      suggestedPost: suggested,
      assignedPost: suggested,
      overriddenBy: null,
      overrideReason: null,
    };
  }
  if (override === undefined) {
    throw new Error(
      `suggestedPost ${suggested} is binding: assigning ${assigned} instead needs an override naming who decided it and why`
    );
  }
  return {
    suggestedPost: suggested,
    assignedPost: assigned,
    overriddenBy: requireText(override.overriddenBy, "override.overriddenBy"),
    overrideReason: requireText(override.reason, "override.reason"),
  };
};

export type OpenSummary = {
  open: readonly OpenEscalation[];
  openCount: number;
  totalEscalations: number;
  d10: boolean;
};

export const openSummary = (
  open: readonly OpenEscalation[],
  totalEscalations: number
): OpenSummary => ({
  open,
  openCount: open.length,
  totalEscalations,
  d10: open.length === 0,
});
