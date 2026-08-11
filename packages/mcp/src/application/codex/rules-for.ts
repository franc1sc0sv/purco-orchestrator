import {
  decideApplicability,
  fallbackAspect,
  pathEvaluation,
} from "../../domain/codex/applicability.ts";
import type {
  FileFacts,
  RuleApplicability,
} from "../../domain/codex/applicability.ts";
import {
  NO_FILE_PATH_REASON,
  notEvaluable,
  notEvaluableExpression,
  parseCheck,
} from "../../domain/codex/check-expression.ts";
import type { CheckEvaluation } from "../../domain/codex/check-expression.ts";
import {
  readAspectIndex,
  readCurrentRows,
} from "../../infrastructure/db/codex-store.ts";
import type { AspectEntry } from "../../infrastructure/db/codex-store.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import { projectRelative } from "../../infrastructure/files.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { astCheck } from "../analysis/check.ts";
import { hydrateRule } from "./hydrate-rule.ts";
import { isAbsolute } from "node:path";
import type { CheckOutcome } from "test-forge-contracts/analysis";
import type { RuleVersion } from "test-forge-contracts/codex";
import type { Scope } from "test-forge-contracts/project";

export type RulesForInput = {
  cwd: string;
  scope?: Scope | undefined;
  filePath?: string | undefined;
};

export type ApplicableRule = RuleVersion & {
  applicability: RuleApplicability;
};

export type ExcludedRule = {
  ruleId: string;
  version: number;
  by: string | null;
  reason: string;
};

export type UnevaluatedRule = {
  ruleId: string;
  version: number;
  reason: string;
};

export type RulesForResult = {
  projectKey: string;
  scope: string;
  filePath: string | null;
  aspects: AspectEntry[];
  rules: ApplicableRule[];
  excluded: ExcludedRule[];
  unevaluated: UnevaluatedRule[];
};

type Runnable = {
  id: string;
  check: string;
};

const MATCHED = "The check matched this file.";

const matchedReason = (outcome: CheckOutcome): string =>
  outcome.sitesTruncated
    ? `${MATCHED} Only ${outcome.sites.length} of its ${outcome.siteCount} sites are listed.`
    : MATCHED;

const NOT_MATCHED = "The check did not match this file.";

const NO_RESULT = "ast_check returned no result for this check.";

const factsOf = (cwd: string, filePath: string): FileFacts => {
  const fromRoot = projectRelative(cwd, filePath);
  return {
    path: filePath,
    projectPath: isAbsolute(fromRoot) ? null : fromRoot,
  };
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runChecks = (
  cwd: string,
  filePath: string,
  runnable: readonly Runnable[]
): Map<string, CheckEvaluation> => {
  const results = new Map<string, CheckEvaluation>();
  let outcomes;
  try {
    outcomes = astCheck({
      cwd,
      filePath,
      checks: runnable.map(({ id, check }) => ({ checkId: id, check })),
    }).checks;
  } catch (error) {
    const reason = `The file could not be read for checking: ${messageOf(
      error
    )}`;
    for (const entry of runnable) {
      results.set(entry.id, notEvaluableExpression(entry.check, reason));
    }
    return results;
  }

  const byId = new Map(outcomes.map((outcome) => [outcome.checkId, outcome]));
  for (const entry of runnable) {
    const outcome = byId.get(entry.id);
    if (outcome === undefined) {
      results.set(entry.id, notEvaluableExpression(entry.check, NO_RESULT));
      continue;
    }
    if (outcome.error !== null) {
      results.set(
        entry.id,
        notEvaluableExpression(
          entry.check,
          `The check did not evaluate: ${outcome.error}`
        )
      );
      continue;
    }
    results.set(entry.id, {
      evaluable: true,
      by: outcome.kind ?? "",
      matched: outcome.violated,
      expression: outcome.expression ?? entry.check,
      sites: outcome.sites,
      reason: outcome.violated ? matchedReason(outcome) : NOT_MATCHED,
    });
  }
  return results;
};

export const rulesFor = async ({
  cwd,
  scope,
  filePath,
}: RulesForInput): Promise<RulesForResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const aspects = readAspectIndex(db, projectKey);
  const hydrated = readCurrentRows(db, projectKey, scope).map((row) =>
    hydrateRule(db, projectKey, row)
  );
  const facts = filePath === undefined ? null : factsOf(cwd, filePath);

  const evaluations = new Map<string, CheckEvaluation>();
  const runnable: Runnable[] = [];
  for (const rule of hydrated) {
    const byPath = pathEvaluation(rule.appliesWhen, facts);
    if (byPath !== null) {
      evaluations.set(rule.id, byPath);
      continue;
    }
    const parsed = parseCheck(rule.appliesWhen.check);
    if (parsed.form !== "grep" && parsed.form !== "expression") {
      evaluations.set(rule.id, notEvaluable(parsed.reason));
      continue;
    }
    if (filePath === undefined) {
      evaluations.set(rule.id, notEvaluable(NO_FILE_PATH_REASON));
      continue;
    }
    runnable.push({ id: rule.id, check: parsed.canonical });
  }

  if (runnable.length > 0 && filePath !== undefined) {
    for (const [id, evaluation] of runChecks(cwd, filePath, runnable)) {
      evaluations.set(id, evaluation);
    }
  }

  const rules: ApplicableRule[] = [];
  const excluded: ExcludedRule[] = [];
  const unevaluated: UnevaluatedRule[] = [];

  for (const rule of hydrated) {
    const check = evaluations.get(rule.id) ?? notEvaluable(NO_FILE_PATH_REASON);
    const aspect =
      aspects.get(`${rule.scope}:${rule.aspect}`) ?? fallbackAspect(rule);
    const decision = decideApplicability({ aspect, rule, facts, check });

    if (!decision.applies) {
      excluded.push({
        ruleId: rule.id,
        version: rule.version,
        by: decision.by,
        reason: decision.reason,
      });
      continue;
    }
    if (!decision.evaluated) {
      unevaluated.push({
        ruleId: rule.id,
        version: rule.version,
        reason: decision.reason,
      });
    }
    rules.push({ ...rule, applicability: decision.applicability });
  }

  const used = new Set(rules.map((rule) => `${rule.scope}:${rule.aspect}`));

  return {
    projectKey,
    scope: scope ?? "all",
    filePath: filePath ?? null,
    aspects: [...used]
      .map((key) => aspects.get(key))
      .filter((aspect): aspect is AspectEntry => aspect !== undefined),
    rules,
    excluded,
    unevaluated,
  };
};
