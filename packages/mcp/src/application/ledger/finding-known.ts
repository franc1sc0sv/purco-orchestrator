import { all, one, openDb } from "../../infrastructure/db/connection.ts";
import type {
  FindingStatus,
  RecordedVerdict,
} from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { WarGameStatus } from "test-forge-contracts/board";
import type { Severity } from "test-forge-contracts/codex";
import type { ExitKind } from "test-forge-contracts/gates";
import type { Scope } from "test-forge-contracts/project";

export type FindingKnownInput = {
  cwd: string;
  fingerprint: string;
};

type OccurrenceRow = {
  id: number;
  run_id: number;
  severity: Severity;
  title: string;
  location: string;
  status: FindingStatus;
  created_at: string;
  focus: string;
  scope: Scope;
  exit_kind: ExitKind | null;
};

type VerdictSummaryRow = {
  id: number;
  run_id: number;
  agent_callsign: string;
  post: string;
  rule_id: string | null;
  verdict: RecordedVerdict;
  created_at: string;
};

type ScenarioRow = {
  id: number;
  squad: string;
  post: string;
  aspect: string;
  status: WarGameStatus;
  root_cause: string;
  created_at: string;
};

export const findingKnown = async ({ cwd, fingerprint }: FindingKnownInput) => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);

  const occurrences = all<OccurrenceRow>(
    db,
    `SELECT f.id, f.run_id, f.severity, f.title, f.location, f.status, f.created_at,
            r.focus, r.scope, r.exit_kind
       FROM findings f
       JOIN runs r ON r.id = f.run_id
      WHERE f.finding_key = ? AND f.project_key = ?
      ORDER BY f.created_at DESC`,
    [fingerprint, projectKey],
  );

  const verdicts = all<VerdictSummaryRow>(
    db,
    `SELECT id, run_id, agent_callsign, post, rule_id, verdict, created_at
       FROM verdicts
      WHERE project_key = ? AND subject_kind = 'finding' AND subject_ref = ?
      ORDER BY created_at DESC`,
    [projectKey, fingerprint],
  );

  const scenario = one<ScenarioRow>(
    db,
    `SELECT id, squad, post, aspect, status, root_cause, created_at
       FROM war_games WHERE project_key = ? AND scenario_key = ?`,
    [projectKey, fingerprint],
  );

  const latest = occurrences[0];

  return {
    projectKey,
    fingerprint,
    known: occurrences.length > 0 || scenario !== null,
    occurrenceCount: occurrences.length,
    lastStatus: latest?.status ?? null,
    lastSeenAt: latest?.created_at ?? null,
    occurrences: occurrences.map((row) => ({
      findingId: row.id,
      runId: row.run_id,
      severity: row.severity,
      title: row.title,
      location: row.location,
      status: row.status,
      createdAt: row.created_at,
      runFocus: row.focus,
      runScope: row.scope,
      runExit: row.exit_kind,
    })),
    verdicts: verdicts.map((row) => ({
      verdictId: row.id,
      runId: row.run_id,
      agentCallsign: row.agent_callsign,
      post: row.post,
      ruleId: row.rule_id,
      verdict: row.verdict,
      createdAt: row.created_at,
    })),
    warGame:
      scenario === null
        ? null
        : {
            scenarioId: scenario.id,
            squad: scenario.squad,
            post: scenario.post,
            aspect: scenario.aspect,
            status: scenario.status,
            rootCause: scenario.root_cause,
            createdAt: scenario.created_at,
          },
  };
};
