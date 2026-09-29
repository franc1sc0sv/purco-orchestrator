import {
  isUsableRetirementReason,
  RETIREMENT_REQUIRES_REASON,
  retiredCopy,
  standingRetirement,
} from "../../domain/codex/rule.ts";
import {
  appendVersion,
  readLatestRow,
} from "../../infrastructure/db/codex-store.ts";
import { nowIso, openDb, tx } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { hydrateRule } from "./hydrate-rule.ts";

export type RetireRuleInput = {
  cwd: string;
  ruleId: string;
  reason: string;
  decidedBy?: string | undefined;
};

export type RetireRuleResult = {
  projectKey: string;
  ruleId: string;
  retired: true;
  alreadyRetired: boolean;
  version: number;
  previousVersion?: number | null;
  rowId?: number;
  retiredAt: string;
  reason: string;
  appendOnly: true;
};

export const retireRule = async ({
  cwd,
  ruleId,
  reason,
  decidedBy,
}: RetireRuleInput): Promise<RetireRuleResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  if (!isUsableRetirementReason(reason)) {
    throw new Error(RETIREMENT_REQUIRES_REASON);
  }
  const latest = readLatestRow(db, projectKey, ruleId);
  if (latest === null) {
    throw new Error(`No rule "${ruleId}" exists for this project`);
  }
  const rule = hydrateRule(db, projectKey, latest);

  const standing = standingRetirement(rule);
  if (standing !== null) {
    return {
      projectKey,
      ruleId,
      retired: true,
      alreadyRetired: true,
      version: standing.version,
      retiredAt: standing.retiredAt,
      reason: standing.reason,
      appendOnly: true,
    };
  }

  const retiredAt = nowIso();
  return tx(db, (txScope) => {
    const written = appendVersion(
      txScope.db,
      projectKey,
      retiredCopy(rule, retiredAt, reason),
      decidedBy ?? "human"
    );
    return {
      projectKey,
      ruleId,
      retired: true,
      alreadyRetired: false,
      version: written.version,
      previousVersion: written.previousVersion,
      rowId: written.rowId,
      retiredAt,
      reason,
      appendOnly: true,
    };
  });
};
