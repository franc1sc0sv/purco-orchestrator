import {
  readCurrentRows,
  readTaxonomyExt,
} from "../../infrastructure/db/codex-store.ts";
import { nowIso, one, openDb } from "../../infrastructure/db/connection.ts";
import type { ProjectRow } from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { hydrateRule } from "./hydrate-rule.ts";
import type { RuleVersion } from "test-forge-contracts/codex";
import type { Scope } from "test-forge-contracts/project";

export type ExportCodexInput = {
  cwd: string;
  scope?: Scope | undefined;
};

export type ExportedAspect = {
  id: string;
  scope: Scope;
  appliesWhen: string;
  blockingBar: string;
};

export type ExportedCodex = {
  schemaVersion: number;
  exportedAt: string;
  project: {
    key: string;
    shortName: string;
    remoteUrl: string | null;
  };
  scope: string;
  aspects: ExportedAspect[];
  rules: RuleVersion[];
};

export const exportCodex = async ({
  cwd,
  scope,
}: ExportCodexInput): Promise<ExportedCodex> => {
  const db = openDb();
  const project = await resolveProject(cwd);
  const stored = one<Pick<ProjectRow, "remote_url">>(
    db,
    `SELECT remote_url FROM projects WHERE project_key = ?`,
    [project.projectKey]
  );

  return {
    schemaVersion: 1,
    exportedAt: nowIso(),
    project: {
      key: project.projectKey,
      shortName: project.shortName,
      remoteUrl: stored?.remote_url ?? null,
    },
    scope: scope ?? "all",
    aspects: readTaxonomyExt(db, project.projectKey, scope).map((row) => ({
      id: row.aspect,
      scope: row.scope,
      appliesWhen: row.applies_when,
      blockingBar: row.blocking_bar,
    })),
    rules: readCurrentRows(db, project.projectKey, scope).map((row) =>
      hydrateRule(db, project.projectKey, row)
    ),
  };
};
