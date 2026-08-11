import {
  appendVersion,
  corpusHashOf,
  insertAcceptance,
  insertFixtures,
  writeCorpusHash,
} from "../../infrastructure/db/codex-store.ts";
import { nowIso, openDb, tx } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { normaliseRuleInput } from "./rule-input.ts";
import type { RuleInput } from "./rule-input.ts";

export type RuleWriteInput = {
  cwd: string;
  rule: RuleInput;
  decidedBy?: string | undefined;
};

export type RuleWriteResult = {
  projectKey: string;
  ruleId: string;
  version: number;
  previousVersion: number | null;
  rowId: number;
  fixturesAdded: number;
  acceptanceRecorded: boolean;
  appendOnly: true;
};

export const ruleWrite = async ({
  cwd,
  rule,
  decidedBy,
}: RuleWriteInput): Promise<RuleWriteResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const draft = normaliseRuleInput(rule);
  const decider = decidedBy ?? rule.decidedBy;
  if (decider === undefined || decider.length === 0) {
    throw new Error("ruleWrite requires decidedBy");
  }

  return tx(db, (txScope) => {
    const written = appendVersion(txScope.db, projectKey, draft, decider);
    const fixturesAdded = insertFixtures(
      txScope.db,
      projectKey,
      draft.id,
      rule.fixtures ?? [],
    );
    const acceptance = rule.acceptance;
    if (acceptance !== undefined) {
      insertAcceptance(
        txScope.db,
        projectKey,
        draft.id,
        written.version,
        acceptance.fixtures ?? 0,
        acceptance.nearMisses ?? 0,
        acceptance.reviewerScore?.passed ?? 0,
        acceptance.reviewerScore?.total ?? 0,
        acceptance.acceptedAt ?? nowIso(),
      );
    }
    const corpusHash = corpusHashOf(draft.evidence);
    if (corpusHash !== null) {
      writeCorpusHash(
        txScope.db,
        projectKey,
        draft.scope,
        draft.aspect,
        corpusHash,
      );
    }
    return {
      projectKey,
      ruleId: draft.id,
      version: written.version,
      previousVersion: written.previousVersion,
      rowId: written.rowId,
      fixturesAdded,
      acceptanceRecorded: acceptance !== undefined,
      appendOnly: true,
    };
  });
};
