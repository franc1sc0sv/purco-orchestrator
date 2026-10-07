import type {
  EscalationClosure,
  OpenEscalation,
} from "test-forge-contracts/escalation";
import {
  ESCALATION_RESOLUTIONS,
  isEscalationResolution,
} from "test-forge-contracts/escalation";

export const requireText = (value: string, field: string): string => {
  const text = value.trim();
  if (text.length === 0) {
    throw new Error(`${field} must be written text but was empty`);
  }
  return text;
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
