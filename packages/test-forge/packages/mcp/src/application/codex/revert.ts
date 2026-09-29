import {
  appendVersion,
  readVersionRow,
} from "../../infrastructure/db/codex-store.ts";
import { openDb, tx } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { hydrateRule } from "./hydrate-rule.ts";

export type RevertInput = {
  cwd: string;
  ruleId: string;
  toVersion: number;
  decidedBy?: string | undefined;
};

export type RevertResult = {
  projectKey: string;
  ruleId: string;
  revertedFrom: number;
  version: number;
  rowId: number;
};

export const revert = async ({
  cwd,
  ruleId,
  toVersion,
  decidedBy,
}: RevertInput): Promise<RevertResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const target = readVersionRow(db, projectKey, ruleId, toVersion);
  if (target === null) {
    throw new Error(
      `No version ${toVersion} of rule "${ruleId}" exists for this project`
    );
  }
  const rule = hydrateRule(db, projectKey, target);

  return tx(db, (txScope) => {
    const written = appendVersion(
      txScope.db,
      projectKey,
      rule,
      decidedBy ?? "human"
    );
    return {
      projectKey,
      ruleId,
      revertedFrom: toVersion,
      version: written.version,
      rowId: written.rowId,
    };
  });
};
