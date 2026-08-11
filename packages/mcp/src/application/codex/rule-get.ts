import {
  readLastAcceptance,
  readLatestRow,
  readLatestVersionNumber,
  readVersionRow,
} from "../../infrastructure/db/codex-store.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { hydrateRule } from "./hydrate-rule.ts";
import type { Acceptance, RuleVersion } from "test-forge-contracts/codex";

export type RuleGetInput = {
  cwd: string;
  ruleId: string;
  version?: number | undefined;
};

export type RuleGetResult = {
  projectKey: string;
  ruleId: string;
  found: boolean;
  isCurrent?: boolean;
  latestVersion?: number | null;
  lastAcceptedVersion?: number | null;
  lastAcceptance?: (Acceptance & { version: number }) | null;
  rule: RuleVersion | null;
};

export const ruleGet = async ({
  cwd,
  ruleId,
  version,
}: RuleGetInput): Promise<RuleGetResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const row =
    version === undefined
      ? readLatestRow(db, projectKey, ruleId)
      : readVersionRow(db, projectKey, ruleId, version);
  if (row === null) {
    return { projectKey, ruleId, found: false, rule: null };
  }

  const latestVersion = readLatestVersionNumber(db, projectKey, ruleId);
  const lastAccepted = readLastAcceptance(db, projectKey, ruleId);

  return {
    projectKey,
    ruleId,
    found: true,
    isCurrent: row.version === latestVersion,
    latestVersion,
    lastAcceptedVersion: lastAccepted?.rule_version ?? null,
    lastAcceptance:
      lastAccepted === null
        ? null
        : {
            version: lastAccepted.rule_version,
            fixtures: lastAccepted.fixture_count,
            nearMisses: lastAccepted.near_miss_count,
            reviewerScore: {
              passed: lastAccepted.score_passed,
              total: lastAccepted.score_total,
            },
            acceptedAt: lastAccepted.accepted_at,
          },
    rule: hydrateRule(db, projectKey, row),
  };
};
