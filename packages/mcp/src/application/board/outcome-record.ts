import {
  KNOWN_EVENT_KINDS,
  isScored,
  polarityOf,
} from "../../domain/board/scoring.ts";
import { openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { resolve } from "node:path";
import type { OutcomePolarity } from "test-forge-contracts/board";

export type BoardOutcomeRecordInput = {
  cwd: string;
  runId?: number | undefined;
  callsign: string;
  post: string;
  aspect?: string | undefined;
  eventKind: string;
  weight?: number | undefined;
};

export type BoardOutcomeRecordResult = {
  outcomeId: number;
  scored: boolean;
  polarity: OutcomePolarity;
  knownEventKinds?: readonly string[];
};

export const boardOutcomeRecord = async ({
  cwd,
  runId,
  callsign,
  post,
  aspect,
  eventKind,
  weight,
}: BoardOutcomeRecordInput): Promise<BoardOutcomeRecordResult> => {
  const db = openDb();
  const projectKey = await projectKeyOf(resolve(cwd));
  const scored = isScored(eventKind);
  const outcomeId = tx(db, (txScope) => {
    const inserted = run(
      txScope.db,
      "INSERT INTO outcomes (project_key, run_id, callsign, post, aspect, event_kind, weight) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        projectKey,
        runId ?? null,
        callsign,
        post,
        aspect ?? "",
        eventKind,
        weight ?? 1,
      ],
    );
    return Number(inserted.lastInsertRowid);
  });
  return {
    outcomeId,
    scored,
    polarity: polarityOf(eventKind),
    ...(scored ? {} : { knownEventKinds: KNOWN_EVENT_KINDS }),
  };
};
