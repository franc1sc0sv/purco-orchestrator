import { failureOf } from "../../domain/batch/failure.ts";
import type { BatchFailure } from "../../domain/batch/failure.ts";
import { boardOutcomeRecord } from "./outcome-record.ts";
import type {
  BoardOutcomeRecordInput,
  BoardOutcomeRecordResult,
} from "./outcome-record.ts";

export type BoardOutcomeRecordBatchItem = Omit<
  BoardOutcomeRecordInput,
  "cwd" | "runId"
>;

export type BoardOutcomeRecordBatchInput = {
  cwd: string;
  runId?: number | undefined;
  outcomes: readonly BoardOutcomeRecordBatchItem[];
};

export type BoardOutcomeRecordBatchRow = BoardOutcomeRecordResult & {
  callsign: string;
  post: string;
  eventKind: string;
};

export type BoardOutcomeRecordBatchResult = {
  requested: number;
  recordedCount: number;
  failedCount: number;
  unscoredCount: number;
  outcomes: BoardOutcomeRecordBatchRow[];
  failures: BatchFailure[];
};

const refOf = (outcome: BoardOutcomeRecordBatchItem): string =>
  `${outcome.callsign}/${outcome.post}::${outcome.eventKind}`;

export const boardOutcomeRecordBatch = async ({
  cwd,
  runId,
  outcomes,
}: BoardOutcomeRecordBatchInput): Promise<BoardOutcomeRecordBatchResult> => {
  const recorded: BoardOutcomeRecordBatchRow[] = [];
  const failures: BatchFailure[] = [];
  for (const outcome of outcomes) {
    try {
      const row = await boardOutcomeRecord({ cwd, runId, ...outcome });
      recorded.push({
        ...row,
        callsign: outcome.callsign,
        post: outcome.post,
        eventKind: outcome.eventKind,
      });
    } catch (error) {
      failures.push(failureOf(refOf(outcome), error));
    }
  }
  return {
    requested: outcomes.length,
    recordedCount: recorded.length,
    failedCount: failures.length,
    unscoredCount: recorded.filter((row) => !row.scored).length,
    outcomes: recorded,
    failures,
  };
};
