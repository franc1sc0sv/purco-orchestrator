import type { CheckRequest } from "test-forge-mcp-server/src/application/analysis/check.ts";
import type { ApplicableRule } from "test-forge-mcp-server/src/application/codex/rules-for.ts";
import type { FindingUpsertBatchItem } from "test-forge-mcp-server/src/application/ledger/finding-upsert-batch.ts";
import type { VerdictRecordBatchItem } from "test-forge-mcp-server/src/application/ledger/verdict-record-batch.ts";
import { parseCheck } from "test-forge-mcp-server/src/domain/codex/check-expression.ts";
import type { CheckOutcome, CheckSite } from "test-forge-contracts/analysis";

export const MECHANICAL_POST = "inspector-mechanical";
export const MECHANICAL_CALLSIGN = "CODE";
const MECHANICAL_NOTE = "the rule is fully mechanical, so code ran its check and no model judged it";

export type MechanicalRule = Pick<
  ApplicableRule,
  "id" | "mechanization" | "severity" | "statement" | "appliesWhen" | "detect" | "violates"
>;

export type MechanicalPlan = {
  mechanical: { rule: MechanicalRule; request: CheckRequest }[];
  residual: MechanicalRule[];
};

export type Judgement = {
  rule: MechanicalRule;
  verdict: "pass" | "violation" | "not-applicable";
  sites: CheckSite[];
};

const requestFor = (rule: MechanicalRule): CheckRequest | undefined => {
  const detect = parseCheck(rule.detect.check);
  if (detect.form !== "grep" && detect.form !== "expression") return undefined;
  const appliesWhen = parseCheck(rule.appliesWhen.check);
  if (appliesWhen.form === "none") return { checkId: rule.id, detect: detect.canonical };
  if (appliesWhen.form === "unparseable") return undefined;
  return { checkId: rule.id, detect: detect.canonical, appliesWhen: appliesWhen.canonical };
};

export const planMechanical = (rules: readonly MechanicalRule[]): MechanicalPlan => {
  const plan: MechanicalPlan = { mechanical: [], residual: [] };
  for (const rule of rules) {
    const request = rule.mechanization === "full" ? requestFor(rule) : undefined;
    if (request) plan.mechanical.push({ rule, request });
    else plan.residual.push(rule);
  }
  return plan;
};

export const judgeOutcome = (
  rule: MechanicalRule,
  outcome: CheckOutcome | undefined,
): Judgement | undefined => {
  if (!outcome || outcome.error !== null || !outcome.evaluable) return undefined;
  if (!outcome.applied) return { rule, verdict: "not-applicable", sites: [] };
  if (outcome.violated) return { rule, verdict: "violation", sites: outcome.sites };
  return { rule, verdict: "pass", sites: [] };
};

export const verdictsFor = (
  file: string,
  judgements: readonly Judgement[],
): VerdictRecordBatchItem[] =>
  judgements.map(({ rule, verdict, sites }) => ({
    subjectKind: "file",
    subjectRef: file,
    ruleId: rule.id,
    post: MECHANICAL_POST,
    agentCallsign: MECHANICAL_CALLSIGN,
    verdict,
    rubric: [],
    sites: sites.map(({ line, quote }) => ({ line, quote, why: MECHANICAL_NOTE })),
  }));

export const findingsFor = (
  file: string,
  judgements: readonly Judgement[],
): FindingUpsertBatchItem[] =>
  judgements
    .filter(({ verdict }) => verdict === "violation")
    .flatMap(({ rule, sites }) =>
      sites.map(({ line, quote }) => ({
        findingKey: `${rule.id}:${file}:${line}`,
        severity: rule.severity,
        title: rule.statement,
        location: `${file}:${line}`,
        evidence: quote,
        proposedFix: rule.violates.human,
      })),
    );
