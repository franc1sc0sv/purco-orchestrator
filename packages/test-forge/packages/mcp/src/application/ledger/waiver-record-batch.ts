import { failureOf } from "../../domain/batch/failure.ts";
import type { BatchFailure } from "../../domain/batch/failure.ts";
import { waiverRecord } from "./waiver-record.ts";
import type { WaiverRecordInput, WaiverRecordResult } from "./waiver-record.ts";

export type WaiverRecordBatchItem = Omit<WaiverRecordInput, "cwd" | "runId">;

export type WaiverRecordBatchInput = {
  cwd: string;
  runId: number;
  waivers: readonly WaiverRecordBatchItem[];
};

export type WaiverRecordBatchResult = {
  requested: number;
  signedCount: number;
  failedCount: number;
  waivers: WaiverRecordResult[];
  failures: BatchFailure[];
};

export const waiverRecordBatch = async ({
  cwd,
  runId,
  waivers,
}: WaiverRecordBatchInput): Promise<WaiverRecordBatchResult> => {
  const signed: WaiverRecordResult[] = [];
  const failures: BatchFailure[] = [];
  for (const waiver of waivers) {
    try {
      signed.push(await waiverRecord({ cwd, runId, ...waiver }));
    } catch (error) {
      failures.push(failureOf(`${waiver.kind}::${String(waiver.ref)}`, error));
    }
  }
  return {
    requested: waivers.length,
    signedCount: signed.length,
    failedCount: failures.length,
    waivers: signed,
    failures,
  };
};
