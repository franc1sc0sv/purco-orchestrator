import { readRetirement } from "../../domain/codex/rule.ts";
import { readAcceptance } from "../../infrastructure/db/codex-store.ts";
import { all, openDb } from "../../infrastructure/db/connection.ts";
import type { CodexVersionRow } from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { Acceptance, Retirement } from "test-forge-contracts/codex";
import type { Mechanization, Severity } from "test-forge-contracts/codex";
import type { Scope } from "test-forge-contracts/project";

export type HistoryInput = {
  cwd: string;
  ruleId: string;
};

export type HistoryEntry = {
  version: number;
  scope: Scope;
  aspect: string;
  severity: Severity;
  mechanization: Mechanization;
  statement: string;
  decidedBy: string;
  createdAt: string;
  retired: Retirement | null;
  acceptance: Acceptance | null;
};

export type HistoryResult = {
  projectKey: string;
  ruleId: string;
  versions: HistoryEntry[];
  currentVersion: number | null;
};

type HistoryRow = Pick<
  CodexVersionRow,
  | "id"
  | "scope"
  | "aspect"
  | "version"
  | "severity"
  | "mechanization"
  | "statement"
  | "decided_by"
  | "created_at"
  | "retired_at"
  | "retired_reason"
>;

export const history = async ({
  cwd,
  ruleId,
}: HistoryInput): Promise<HistoryResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const rows = all<HistoryRow>(
    db,
    `SELECT id, scope, aspect, version, severity, mechanization, statement, decided_by, created_at,
            retired_at, retired_reason
       FROM codex_versions
      WHERE project_key = ? AND rule_id = ?
      ORDER BY version ASC`,
    [projectKey, ruleId],
  );

  return {
    projectKey,
    ruleId,
    versions: rows.map((row) => ({
      version: row.version,
      scope: row.scope,
      aspect: row.aspect,
      severity: row.severity,
      mechanization: row.mechanization,
      statement: row.statement,
      decidedBy: row.decided_by,
      createdAt: row.created_at,
      retired: readRetirement(row.retired_at, row.retired_reason),
      acceptance: readAcceptance(db, projectKey, ruleId, row.version),
    })),
    currentVersion: rows[rows.length - 1]?.version ?? null,
  };
};
