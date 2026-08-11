import type { ExitKind } from "test-forge-contracts/gates";

export const STALL_LIMIT = 2;

export type ExitDecision = {
  kind: ExitKind;
  reason: string;
};

export type ExitSignals = {
  recordedKind: ExitKind | null;
  recordedReason: string;
  closingText: string;
  allTrue: boolean;
  passStalled: boolean;
  cyclesWithoutPass: number;
};

export const decideExit = (signals: ExitSignals): ExitDecision | null => {
  if (signals.recordedKind !== null) {
    const recorded = signals.recordedReason.trim();
    return {
      kind: signals.recordedKind,
      reason: recorded.length > 0 ? recorded : signals.closingText.trim(),
    };
  }

  if (signals.allTrue) {
    return { kind: "DONE", reason: "All ten predicates are true." };
  }

  if (signals.passStalled) {
    return {
      kind: "STALLED",
      reason: "Two consecutive passes carry an identical done vector.",
    };
  }

  if (signals.cyclesWithoutPass >= STALL_LIMIT) {
    return {
      kind: "STALLED",
      reason:
        "Two consecutive cycles recorded no pass. The board did not move.",
    };
  }

  return null;
};
