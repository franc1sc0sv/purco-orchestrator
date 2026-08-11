import { one, openDb, run } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import type { WaiverKind, WaiverRow } from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { requireEnum, WAIVER_KINDS } from "./ledger-input.ts";

export type WaiverRecordInput = {
  cwd: string;
  runId: number;
  kind: WaiverKind;
  ref: string | number;
  reason: string;
  signedBy?: string | undefined;
};

export type WaiverRecordResult = {
  projectKey: string;
  runId: number;
  waiverId: number;
  kind: WaiverKind;
  ref: string;
  signedBy: string;
  createdAt: string;
};

export const waiverRecord = async ({
  cwd,
  runId,
  kind,
  ref,
  reason,
  signedBy,
}: WaiverRecordInput): Promise<WaiverRecordResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);
  requireEnum(kind, WAIVER_KINDS, "kind");
  if (reason.trim().length === 0) {
    throw new Error("A waiver needs a written reason");
  }
  const reference = String(ref);

  run(
    db,
    `INSERT INTO waivers (project_key, run_id, kind, ref, reason, signed_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (run_id, kind, ref) DO UPDATE
       SET reason = excluded.reason, signed_by = excluded.signed_by`,
    [projectKey, runId, kind, reference, reason, signedBy ?? "human"]
  );

  const row = one<WaiverRow>(
    db,
    `SELECT * FROM waivers WHERE run_id = ? AND kind = ? AND ref = ?`,
    [runId, kind, reference]
  );
  if (row === null) {
    throw new Error(`Waiver ${kind}::${reference} was not stored`);
  }
  return {
    projectKey,
    runId,
    waiverId: row.id,
    kind: row.kind,
    ref: row.ref,
    signedBy: row.signed_by,
    createdAt: row.created_at,
  };
};
