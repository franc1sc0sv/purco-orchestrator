import {
  postDecisionOf,
  requireText,
} from "../../domain/escalation/escalation.ts";
import {
  nowIso,
  one,
  openDb,
  run,
} from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import type { AssignmentRow } from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { DatabaseSync } from "node:sqlite";
import type {
  EscalationSubjectKind,
  PostOverride,
} from "test-forge-contracts/escalation";
import type { Outcome } from "test-forge-contracts/outcome";
import { escalationKeyOf } from "test-forge-contracts/outcome";

export type AssignmentRecordInput = {
  cwd: string;
  runId: number;
  assignmentKey: string;
  suggestedPost: string;
  assignedPost?: string | undefined;
  assignedTo: string;
  subjectKind: EscalationSubjectKind;
  subjectRef: string;
  instruction: string;
  override?: PostOverride | undefined;
  outcome?: Outcome | undefined;
};

export type AssignmentRecordResult = {
  projectKey: string;
  runId: number;
  assignmentId: number;
  assignmentKey: string;
  suggestedPost: string;
  assignedPost: string;
  postOverridden: boolean;
  outcomeKind: string | null;
  escalationId: number | null;
  completedAt: string | null;
};

type EscalationIdRow = { id: number };

const escalationIdFor = (
  db: DatabaseSync,
  runId: number,
  outcome: Outcome | undefined
): number | null => {
  if (outcome === undefined) return null;
  const key = escalationKeyOf(outcome);
  if (key === null) return null;
  const row = one<EscalationIdRow>(
    db,
    "SELECT id FROM escalations WHERE run_id = ? AND escalation_key = ?",
    [runId, key]
  );
  if (row === null) {
    throw new Error(
      `Outcome ${outcome.kind} names escalation ${key}, which was never raised on run ${runId}. Call escalation_raise first, so the block is visible.`
    );
  }
  return row.id;
};

export const assignmentRecord = async ({
  cwd,
  runId,
  assignmentKey,
  suggestedPost,
  assignedPost,
  assignedTo,
  subjectKind,
  subjectRef,
  instruction,
  override,
  outcome,
}: AssignmentRecordInput): Promise<AssignmentRecordResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);

  const key = requireText(assignmentKey, "assignmentKey");
  const decision = postDecisionOf({ suggestedPost, assignedPost, override });
  const escalationId = escalationIdFor(db, runId, outcome);
  const completedAt = outcome === undefined ? null : nowIso();

  run(
    db,
    `INSERT INTO assignments
       (project_key, run_id, assignment_key, suggested_post, assigned_post, assigned_to,
        subject_kind, subject_ref, instruction, override_by, override_reason,
        outcome_kind, outcome_json, escalation_id, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (run_id, assignment_key) DO UPDATE
       SET suggested_post = excluded.suggested_post,
           assigned_post = excluded.assigned_post,
           assigned_to = excluded.assigned_to,
           subject_kind = excluded.subject_kind,
           subject_ref = excluded.subject_ref,
           instruction = excluded.instruction,
           override_by = excluded.override_by,
           override_reason = excluded.override_reason,
           outcome_kind = excluded.outcome_kind,
           outcome_json = excluded.outcome_json,
           escalation_id = excluded.escalation_id,
           completed_at = excluded.completed_at`,
    [
      projectKey,
      runId,
      key,
      decision.suggestedPost,
      decision.assignedPost,
      requireText(assignedTo, "assignedTo"),
      subjectKind,
      requireText(subjectRef, "subjectRef"),
      requireText(instruction, "instruction"),
      decision.overriddenBy,
      decision.overrideReason,
      outcome === undefined ? null : outcome.kind,
      outcome === undefined ? null : JSON.stringify(outcome),
      escalationId,
      completedAt,
    ]
  );

  const row = one<AssignmentRow>(
    db,
    "SELECT * FROM assignments WHERE run_id = ? AND assignment_key = ?",
    [runId, key]
  );
  if (row === null) {
    throw new Error(`Assignment ${key} was not stored`);
  }

  return {
    projectKey,
    runId,
    assignmentId: row.id,
    assignmentKey: row.assignment_key,
    suggestedPost: row.suggested_post,
    assignedPost: row.assigned_post,
    postOverridden: row.assigned_post !== row.suggested_post,
    outcomeKind: row.outcome_kind,
    escalationId: row.escalation_id,
    completedAt: row.completed_at,
  };
};
