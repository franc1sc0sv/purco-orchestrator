import type { CheckEvaluation } from "./check-expression.ts";
import { pathsOf } from "./check-expression.ts";
import type { Procedure, Rule } from "test-forge-contracts/codex";
import type { Scope } from "test-forge-contracts/project";

export const EXCLUDED_BY_PATH =
  "The file path matches the exclude list of this check.";

export const OUTSIDE_INCLUDE_PATHS =
  "The file path is outside the include list of this check.";

export const FALLBACK_BLOCKING_BAR = "majority";

export type FileFacts = {
  path: string;
  projectPath: string | null;
};

export type AspectFacts = {
  id: string;
  scope: Scope;
  title: string;
  appliesWhen: string;
  blockingBar: string;
  source: string;
};

export type RuleApplicability = {
  aspect: {
    id: string;
    appliesWhen: string;
    blockingBar: string;
    decidedBy: "human";
  };
  rule: CheckEvaluation;
};

export type ApplicabilityDecision = {
  applies: boolean;
  evaluated: boolean;
  by: string | null;
  reason: string;
  applicability: RuleApplicability;
};

const GLOB_TOKEN = /\*\*\/|\*\*|\*|\?|[.+^${}()|[\]\\]/g;

export const globToRegExp = (glob: string): RegExp => {
  const body = glob.replace(GLOB_TOKEN, (token) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "**") return ".*";
    if (token === "*") return "[^/]*";
    if (token === "?") return "[^/]";
    return `\\${token}`;
  });
  return new RegExp(`^${body}$`);
};

export const matchesAny = (
  patterns: readonly string[],
  candidates: readonly string[]
): boolean =>
  patterns.some((pattern) => {
    const regex = globToRegExp(pattern);
    return candidates.some((candidate) => regex.test(candidate));
  });

export const pathCandidates = (facts: FileFacts): string[] => {
  const normalised = facts.path.split("\\").join("/").replace(/^\.\//, "");
  const candidates = new Set([
    normalised,
    normalised.slice(normalised.lastIndexOf("/") + 1),
  ]);
  if (facts.projectPath !== null && facts.projectPath.length > 0) {
    candidates.add(facts.projectPath);
  }
  return [...candidates];
};

export const pathEvaluation = (
  procedure: Procedure | null | undefined,
  facts: FileFacts | null
): CheckEvaluation | null => {
  const paths = pathsOf(procedure);
  if (paths === null || facts === null) return null;
  const candidates = pathCandidates(facts);
  if (paths.exclude.length > 0 && matchesAny(paths.exclude, candidates)) {
    return {
      evaluable: true,
      by: "path",
      matched: false,
      sites: [],
      reason: EXCLUDED_BY_PATH,
    };
  }
  if (paths.include.length > 0 && !matchesAny(paths.include, candidates)) {
    return {
      evaluable: true,
      by: "path",
      matched: false,
      sites: [],
      reason: OUTSIDE_INCLUDE_PATHS,
    };
  }
  return null;
};

export const fallbackAspect = (
  rule: Pick<Rule, "aspect" | "scope">
): AspectFacts => ({
  id: rule.aspect,
  scope: rule.scope,
  title: rule.aspect,
  appliesWhen: "",
  blockingBar: FALLBACK_BLOCKING_BAR,
  source: "unknown",
});

export const decideApplicability = ({
  aspect,
  rule,
  facts,
  check,
}: {
  aspect: AspectFacts;
  rule: Pick<Rule, "appliesWhen">;
  facts: FileFacts | null;
  check: CheckEvaluation;
}): ApplicabilityDecision => {
  const evaluation = pathEvaluation(rule.appliesWhen, facts) ?? check;
  return {
    applies: !(evaluation.evaluable && evaluation.matched === false),
    evaluated: evaluation.evaluable,
    by: evaluation.evaluable ? evaluation.by : null,
    reason: evaluation.reason,
    applicability: {
      aspect: {
        id: aspect.id,
        appliesWhen: aspect.appliesWhen,
        blockingBar: aspect.blockingBar,
        decidedBy: "human",
      },
      rule: evaluation,
    },
  };
};
