import { openSummary } from "../../domain/escalation/escalation.ts";
import type { OpenSummary } from "../../domain/escalation/escalation.ts";
import { all, one, openDb } from "../../infrastructure/db/connection.ts";
import type { EscalationRow } from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";

export type EscalationOpenInput = {
  cwd: string;
  runId: number;
};

export type EscalationOpenResult = OpenSummary & {
  projectKey: string;
  runId: number;
};

type CountRow = { total: number };

type OpenRow = Pick<
  EscalationRow,
  | "escalation_key"
  | "raised_by"
  | "post"
  | "subject_kind"
  | "subject_ref"
  | "claim"
>;

export const escalationOpen = async ({
  cwd,
  runId,
}: EscalationOpenInput): Promise<EscalationOpenResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);

  const rows = all<OpenRow>(
    db,
    `SELECT escalation_key, raised_by, post, subject_kind, subject_ref, claim
       FROM escalations
      WHERE project_key = ? AND run_id = ? AND state = 'open'
      ORDER BY id`,
    [projectKey, runId]
  );

  const total =
    one<CountRow>(
      db,
      "SELECT COUNT(*) AS total FROM escalations WHERE project_key = ? AND run_id = ?",
      [projectKey, runId]
    )?.total ?? 0;

  return {
    projectKey,
    runId,
    ...openSummary(
      rows.map((row) => ({
        escalationKey: row.escalation_key,
        raisedBy: row.raised_by,
        post: row.post,
        subjectKind: row.subject_kind,
        subjectRef: row.subject_ref,
        claim: row.claim,
      })),
      total
    ),
  };
};
