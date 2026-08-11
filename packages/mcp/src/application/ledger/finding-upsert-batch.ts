import { failureOf } from "../../domain/batch/failure.ts";
import type { BatchFailure } from "../../domain/batch/failure.ts";
import { findingUpsert } from "./finding-upsert.ts";
import type {
  FindingUpsertInput,
  FindingUpsertResult,
} from "./finding-upsert.ts";

export type FindingUpsertBatchItem = Omit<FindingUpsertInput, "cwd" | "runId">;

export type FindingUpsertBatchInput = {
  cwd: string;
  runId: number;
  findings: readonly FindingUpsertBatchItem[];
};

export type FindingUpsertBatchResult = {
  requested: number;
  storedCount: number;
  failedCount: number;
  blockingCount: number;
  deduplicatedCount: number;
  findings: FindingUpsertResult[];
  failures: BatchFailure[];
};

export const findingUpsertBatch = async ({
  cwd,
  runId,
  findings,
}: FindingUpsertBatchInput): Promise<FindingUpsertBatchResult> => {
  const stored: FindingUpsertResult[] = [];
  const failures: BatchFailure[] = [];
  for (const finding of findings) {
    try {
      stored.push(await findingUpsert({ cwd, runId, ...finding }));
    } catch (error) {
      failures.push(failureOf(finding.findingKey, error));
    }
  }
  return {
    requested: findings.length,
    storedCount: stored.length,
    failedCount: failures.length,
    blockingCount: stored.filter((row) => row.severity === "blocking").length,
    deduplicatedCount: stored.filter((row) => row.deduplicated).length,
    findings: stored,
    failures,
  };
};
