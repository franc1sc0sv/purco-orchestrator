import { failureOf } from "../../domain/batch/failure.ts";
import type { ResolutionOutcome } from "../../domain/closure/resolution.ts";
import { closureResolve } from "./resolve.ts";
import { closureUnresolved } from "./unresolved.ts";
import type { Resolution } from "test-forge-contracts/closure";

export type ClosureResolveBatchItem = {
  nodeId: string;
  resolution: Resolution;
};

export type ClosureResolveBatchInput = {
  cwd: string;
  runId: number;
  resolutions: readonly ClosureResolveBatchItem[];
};

export type ClosureResolveOutcome = {
  nodeId: string;
  kind: Resolution["kind"];
  resolved: boolean;
  verified: boolean;
  detail: string;
};

export type ClosureResolveBatchResult = {
  requested: number;
  resolvedCount: number;
  rejectedCount: number;
  outcomes: ClosureResolveOutcome[];
  rejections: ClosureResolveOutcome[];
  unresolvedCount: number;
  totalNodes: number;
  d8: boolean;
};

const detailOf = (outcome: ResolutionOutcome): string => {
  if (!outcome.resolved) return outcome.reason;
  if ("citation" in outcome) return outcome.citation;
  if ("plannedTest" in outcome) return outcome.plannedTest;
  return outcome.waivedBy;
};

export const closureResolveBatch = async ({
  cwd,
  runId,
  resolutions,
}: ClosureResolveBatchInput): Promise<ClosureResolveBatchResult> => {
  const outcomes: ClosureResolveOutcome[] = [];
  for (const item of resolutions) {
    try {
      const outcome = await closureResolve({
        cwd,
        runId,
        nodeId: item.nodeId,
        resolution: item.resolution,
      });
      outcomes.push({
        nodeId: item.nodeId,
        kind: item.resolution.kind,
        resolved: outcome.resolved,
        verified: outcome.verified,
        detail: detailOf(outcome),
      });
    } catch (error) {
      outcomes.push({
        nodeId: item.nodeId,
        kind: item.resolution.kind,
        resolved: false,
        verified: false,
        detail: failureOf(item.nodeId, error).error,
      });
    }
  }

  const remaining = await closureUnresolved({ cwd, runId });
  const rejections = outcomes.filter((outcome) => !outcome.resolved);
  return {
    requested: resolutions.length,
    resolvedCount: outcomes.length - rejections.length,
    rejectedCount: rejections.length,
    outcomes,
    rejections,
    unresolvedCount: remaining.unresolvedCount,
    totalNodes: remaining.totalNodes,
    d8: remaining.d8,
  };
};
