import {
  insertAcceptance,
  readAcceptance,
  readFixtures,
} from "../../infrastructure/db/codex-store.ts";
import { nowIso, one, openDb } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { ReviewerScore } from "test-forge-contracts/codex";

export type AcceptRuleInput = {
  cwd: string;
  ruleId: string;
  ruleVersion: number;
  scorePassed: number;
  scoreTotal: number;
};

export type AcceptRuleRefusal = {
  projectKey: string;
  ruleId: string;
  ruleVersion: number;
  accepted: false;
  reason: string;
};

export type AcceptRuleAcceptance = {
  projectKey: string;
  ruleId: string;
  ruleVersion: number;
  accepted: true;
  alreadyAccepted: boolean;
  fixtures: number;
  nearMisses: number;
  reviewerScore: ReviewerScore;
  acceptedAt: string;
  boundaryProbed: boolean;
};

export type AcceptRuleResult = AcceptRuleRefusal | AcceptRuleAcceptance;

export const acceptRule = async ({
  cwd,
  ruleId,
  ruleVersion,
  scorePassed,
  scoreTotal,
}: AcceptRuleInput): Promise<AcceptRuleResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const refuse = (reason: string): AcceptRuleRefusal => ({
    projectKey,
    ruleId,
    ruleVersion,
    accepted: false,
    reason,
  });

  const row = one<{ version: number; retired_at: string | null }>(
    db,
    `SELECT version, retired_at FROM codex_versions
      WHERE project_key = ? AND rule_id = ? AND version = ?`,
    [projectKey, ruleId, ruleVersion]
  );
  if (row === null) {
    return refuse(
      `No version ${ruleVersion} of rule "${ruleId}" exists for this project.`
    );
  }
  if (row.retired_at !== null) {
    return refuse(
      `Version ${ruleVersion} of rule "${ruleId}" is retired, so it cannot be accepted.`
    );
  }

  const passed = Number(scorePassed);
  const total = Number(scoreTotal);
  if (!Number.isInteger(passed) || !Number.isInteger(total)) {
    return refuse("scorePassed and scoreTotal must both be whole numbers.");
  }
  if (passed < 0 || total < 0) {
    return refuse("scorePassed and scoreTotal must not be negative.");
  }
  if (total < 1) {
    return refuse(
      "The score covers no labelled file. A rule scored against nothing was never reviewed, so acceptance is refused."
    );
  }
  if (passed > total) {
    return refuse(
      `The score claims ${passed} passes out of ${total} labelled files, which is impossible.`
    );
  }
  if (passed < total) {
    return refuse(
      `The rule agreed with ${passed} of ${total} labelled files. A rule that misses one labelled file will miss real ones, so acceptance is refused. Redraft the rule, or correct the label, then score it again.`
    );
  }

  const fixtures = readFixtures(db, projectKey, ruleId);
  const nearMisses = fixtures.filter(
    (fixture) => fixture.isNearMiss === true
  ).length;
  const standing = readAcceptance(db, projectKey, ruleId, ruleVersion);

  insertAcceptance(
    db,
    projectKey,
    ruleId,
    ruleVersion,
    fixtures.length,
    nearMisses,
    passed,
    total,
    nowIso()
  );

  const recorded = readAcceptance(db, projectKey, ruleId, ruleVersion);
  if (recorded === null) {
    return refuse(
      `The acceptance of version ${ruleVersion} of rule "${ruleId}" was not stored.`
    );
  }
  return {
    projectKey,
    ruleId,
    ruleVersion,
    accepted: true,
    alreadyAccepted: standing !== null,
    fixtures: recorded.fixtures,
    nearMisses: recorded.nearMisses,
    reviewerScore: recorded.reviewerScore,
    acceptedAt: recorded.acceptedAt,
    boundaryProbed: nearMisses > 0,
  };
};
