import { failureOf } from "../../domain/batch/failure.ts";
import type { BatchFailure } from "../../domain/batch/failure.ts";
import { verdictRecord } from "./verdict-record.ts";
import type {
  VerdictRecordInput,
  VerdictRecordResult,
} from "./verdict-record.ts";

export type VerdictRecordBatchItem = Omit<VerdictRecordInput, "cwd" | "runId">;

export type VerdictRecordBatchInput = {
  cwd: string;
  runId: number;
  verdicts: readonly VerdictRecordBatchItem[];
};

export type VerdictRecordBatchResult = {
  requested: number;
  recordedCount: number;
  failedCount: number;
  focusMappedCount: number;
  verdicts: VerdictRecordResult[];
  failures: BatchFailure[];
};

export const verdictRecordBatch = async ({
  cwd,
  runId,
  verdicts,
}: VerdictRecordBatchInput): Promise<VerdictRecordBatchResult> => {
  const recorded: VerdictRecordResult[] = [];
  const failures: BatchFailure[] = [];
  for (const verdict of verdicts) {
    try {
      recorded.push(await verdictRecord({ cwd, runId, ...verdict }));
    } catch (error) {
      failures.push(
        failureOf(`${verdict.subjectKind}::${verdict.subjectRef}`, error)
      );
    }
  }
  return {
    requested: verdicts.length,
    recordedCount: recorded.length,
    failedCount: failures.length,
    focusMappedCount: recorded.filter((row) => row.focusResolution === "mapped")
      .length,
    verdicts: recorded,
    failures,
  };
};
