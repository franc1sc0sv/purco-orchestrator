import { requireText } from "../../domain/escalation/escalation.ts";
import { one, openDb, run } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import type { EscalationRow } from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { EscalationSubjectKind } from "test-forge-contracts/escalation";

export type EscalationRaiseInput = {
  cwd: string;
  runId: number;
  escalationKey: string;
  raisedBy: string;
  post: string;
  subjectKind: EscalationSubjectKind;
  subjectRef: string;
  claim: string;
  evidence: string;
};

export type EscalationRaiseResult = {
  projectKey: string;
  runId: number;
  escalationId: number;
  escalationKey: string;
  raisedBy: string;
  subjectKind: string;
  subjectRef: string;
  claim: string;
  state: string;
  created: boolean;
  openCount: number;
  d10: boolean;
  createdAt: string;
};

type CountRow = { total: number };

export const escalationRaise = async ({
  cwd,
  runId,
  escalationKey,
  raisedBy,
  post,
  subjectKind,
  subjectRef,
  claim,
  evidence,
}: EscalationRaiseInput): Promise<EscalationRaiseResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);

  const key = requireText(escalationKey, "escalationKey");
  const summary = run(
    db,
    `INSERT INTO escalations
       (project_key, run_id, escalation_key, raised_by, post, subject_kind, subject_ref, claim, evidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (run_id, escalation_key) DO NOTHING`,
    [
      projectKey,
      runId,
      key,
      requireText(raisedBy, "raisedBy"),
      requireText(post, "post"),
      subjectKind,
      requireText(subjectRef, "subjectRef"),
      requireText(claim, "claim"),
      requireText(evidence, "evidence"),
    ]
  );

  const row = one<EscalationRow>(
    db,
    "SELECT * FROM escalations WHERE run_id = ? AND escalation_key = ?",
    [runId, key]
  );
  if (row === null) {
    throw new Error(`Escalation ${key} was not stored`);
  }

  const open =
    one<CountRow>(
      db,
      "SELECT COUNT(*) AS total FROM escalations WHERE project_key = ? AND run_id = ? AND state = 'open'",
      [projectKey, runId]
    )?.total ?? 0;

  return {
    projectKey,
    runId,
    escalationId: row.id,
    escalationKey: row.escalation_key,
    raisedBy: row.raised_by,
    subjectKind: row.subject_kind,
    subjectRef: row.subject_ref,
    claim: row.claim,
    state: row.state,
    created: Number(summary.changes) === 1,
    openCount: open,
    d10: open === 0,
    createdAt: row.created_at,
  };
};
