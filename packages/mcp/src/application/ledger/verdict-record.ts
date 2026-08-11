import { openDb, run, tx } from "../../infrastructure/db/connection.ts";
import {
  applyFindingVerdict,
  applyFocusVerdict,
  requireRun,
} from "../../infrastructure/db/ledger-store.ts";
import type {
  FindingStatus,
  FocusResolution,
  RecordedVerdict,
  SubjectKind,
} from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import {
  RECORDED_VERDICTS,
  requireEnum,
  SUBJECT_KINDS,
} from "./ledger-input.ts";

export type VerdictRecordInput = {
  cwd: string;
  runId: number;
  subjectKind: SubjectKind;
  subjectRef: string;
  agentCallsign?: string | undefined;
  post?: string | undefined;
  ruleId?: string | undefined;
  verdict: RecordedVerdict;
  rubric?: unknown[] | undefined;
  sites?: unknown[] | undefined;
  testRef?: string | undefined;
};

export type VerdictRecordResult = {
  projectKey: string;
  runId: number;
  verdictId: number;
  subjectKind: SubjectKind;
  subjectRef: string;
  verdict: RecordedVerdict;
  findingStatus: FindingStatus | null;
  focusResolution: FocusResolution | null;
};

export const verdictRecord = async ({
  cwd,
  runId,
  subjectKind,
  subjectRef,
  agentCallsign,
  post,
  ruleId,
  verdict,
  rubric,
  sites,
  testRef,
}: VerdictRecordInput): Promise<VerdictRecordResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);
  requireEnum(subjectKind, SUBJECT_KINDS, "subjectKind");
  requireEnum(verdict, RECORDED_VERDICTS, "verdict");
  const citation = (testRef ?? "").trim();
  if (subjectKind === "focus-item" && verdict === "pass" && citation === "") {
    throw new Error(
      "A focus-item pass must cite in testRef the test that carries the line",
    );
  }

  return tx(db, (txScope) => {
    const inserted = run(
      txScope.db,
      `INSERT INTO verdicts
         (run_id, project_key, subject_kind, subject_ref, agent_callsign, post, rule_id, verdict, rubric_json, sites_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        projectKey,
        subjectKind,
        subjectRef,
        agentCallsign ?? "unknown",
        post ?? "",
        ruleId ?? null,
        verdict,
        JSON.stringify(rubric ?? []),
        JSON.stringify(sites ?? []),
      ],
    );

    return {
      projectKey,
      runId,
      verdictId: Number(inserted.lastInsertRowid),
      subjectKind,
      subjectRef,
      verdict,
      findingStatus:
        subjectKind === "finding"
          ? applyFindingVerdict(txScope.db, runId, subjectRef, verdict)
          : null,
      focusResolution:
        subjectKind === "focus-item"
          ? applyFocusVerdict(txScope.db, runId, subjectRef, verdict, citation)
          : null,
    };
  });
};
