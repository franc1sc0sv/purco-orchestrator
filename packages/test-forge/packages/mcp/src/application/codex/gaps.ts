import {
  readAcceptance,
  readAspectIndex,
  readCurrentRows,
  readFixtures,
  readLastAcceptedVersion,
} from "../../infrastructure/db/codex-store.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { Scope } from "test-forge-contracts/project";

export type GapsInput = {
  cwd: string;
  scope?: Scope | undefined;
};

type RuleEntry = {
  ruleId: string;
  version: number;
  scope: Scope;
  aspect: string;
  statement: string;
};

export type MissingFixtures = RuleEntry & { reason: string };

export type MissingNearMiss = RuleEntry & {
  fixtures: number;
  reason: string;
};

export type NotAccepted = RuleEntry & {
  lastAcceptedVersion: number | null;
  reason: string;
};

export type UncoveredAspect = {
  aspect: string;
  scope: Scope;
  title: string;
  appliesWhen: string;
  blockingBar: string;
  source: string;
  reason: string;
};

export const gaps = async ({ cwd, scope }: GapsInput) => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const index = readAspectIndex(db, projectKey);
  const rows = readCurrentRows(db, projectKey, scope);

  const aspectsWithRule = new Set<string>();
  const rulesWithoutFixtures: MissingFixtures[] = [];
  const rulesWithoutNearMiss: MissingNearMiss[] = [];
  const rulesNotAccepted: NotAccepted[] = [];

  for (const row of rows) {
    aspectsWithRule.add(`${row.scope}:${row.aspect}`);
    const entry: RuleEntry = {
      ruleId: row.rule_id,
      version: row.version,
      scope: row.scope,
      aspect: row.aspect,
      statement: row.statement,
    };
    const fixtures = readFixtures(db, projectKey, row.rule_id);
    const nearMisses = fixtures.filter(
      (fixture) => fixture.isNearMiss === true,
    ).length;
    if (fixtures.length === 0) {
      rulesWithoutFixtures.push({
        ...entry,
        reason:
          "The rule has no labelled file, so nothing has ever tested whether it decides correctly.",
      });
    } else if (nearMisses === 0) {
      rulesWithoutNearMiss.push({
        ...entry,
        fixtures: fixtures.length,
        reason:
          "The rule has fixtures but no near-miss, so its boundary has never been probed.",
      });
    }
    if (readAcceptance(db, projectKey, row.rule_id, row.version) === null) {
      const previous = readLastAcceptedVersion(db, projectKey, row.rule_id);
      rulesNotAccepted.push({
        ...entry,
        lastAcceptedVersion: previous,
        reason:
          previous === null
            ? "The rule has never been accepted, so it carries no reviewer score."
            : `Version ${previous} was accepted, but the current version ${row.version} was not.`,
      });
    }
  }

  const inScope = [...index.values()].filter(
    (entry) => scope === undefined || entry.scope === scope,
  );

  const aspectsWithoutRule: UncoveredAspect[] = inScope
    .filter((entry) => !aspectsWithRule.has(`${entry.scope}:${entry.id}`))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id))
    .map((entry) => ({
      aspect: entry.id,
      scope: entry.scope,
      title: entry.title,
      appliesWhen: entry.appliesWhen,
      blockingBar: entry.blockingBar,
      source: entry.source,
      reason:
        "The aspect has no rule, so a file that violates it passes without a word.",
    }));

  return {
    projectKey,
    scope: scope ?? "all",
    aspectsWithoutRule,
    rulesWithoutFixtures,
    rulesWithoutNearMiss,
    rulesNotAccepted,
    summary: {
      aspects: inScope.length,
      rules: rows.length,
      aspectsWithoutRule: aspectsWithoutRule.length,
      rulesWithoutFixtures: rulesWithoutFixtures.length,
      rulesWithoutNearMiss: rulesWithoutNearMiss.length,
      rulesNotAccepted: rulesNotAccepted.length,
      clear:
        aspectsWithoutRule.length === 0 &&
        rulesWithoutFixtures.length === 0 &&
        rulesWithoutNearMiss.length === 0 &&
        rulesNotAccepted.length === 0,
    },
  };
};
