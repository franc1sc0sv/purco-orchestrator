import { failureOf } from "../../domain/batch/failure.ts";
import type { BatchFailure } from "../../domain/batch/failure.ts";
import { unitUpsert } from "./unit-upsert.ts";
import type { UnitUpsertInput, UnitUpsertResult } from "./unit-upsert.ts";

export type UnitUpsertBatchItem = Omit<UnitUpsertInput, "cwd" | "runId">;

export type UnitUpsertBatchInput = {
  cwd: string;
  runId: number;
  units: readonly UnitUpsertBatchItem[];
};

export type UnitUpsertBatchResult = {
  requested: number;
  storedCount: number;
  failedCount: number;
  units: UnitUpsertResult[];
  failures: BatchFailure[];
};

export const unitUpsertBatch = async ({
  cwd,
  runId,
  units,
}: UnitUpsertBatchInput): Promise<UnitUpsertBatchResult> => {
  const stored: UnitUpsertResult[] = [];
  const failures: BatchFailure[] = [];
  for (const unit of units) {
    try {
      stored.push(await unitUpsert({ cwd, runId, ...unit }));
    } catch (error) {
      failures.push(failureOf(unit.filePath, error));
    }
  }
  return {
    requested: units.length,
    storedCount: stored.length,
    failedCount: failures.length,
    units: stored,
    failures,
  };
};
