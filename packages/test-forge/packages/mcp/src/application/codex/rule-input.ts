import { normaliseProcedure } from "../../domain/codex/check-expression.ts";
import {
  DEFAULT_VERDICT_SPACE,
  emptyEvidence,
} from "../../domain/codex/rule.ts";
import type {
  AcceptanceInput,
  FixtureInput,
  RuleDraft,
} from "../../infrastructure/db/codex-store.ts";
import { MECHANIZATIONS, SEVERITIES } from "test-forge-contracts/codex";
import type {
  CheckExpression,
  Evidence,
  Procedure,
  ProcedurePaths,
  Retirement,
  RubricItem,
  Severity,
  Verdict,
} from "test-forge-contracts/codex";
import { SCOPES } from "test-forge-contracts/project";

export type ProcedureInput = {
  human?: string;
  check?: CheckExpression;
  paths?: ProcedurePaths;
};

export type RuleInput = {
  id?: string;
  aspect?: string;
  scope?: string;
  severity?: string;
  mechanization?: string;
  statement?: string;
  rationale?: string;
  archaeology?: string;
  appliesWhen?: ProcedureInput;
  detect?: ProcedureInput;
  violates?: ProcedureInput;
  rubric?: RubricItem[];
  verdictSpace?: Verdict[];
  evidence?: Evidence;
  fixtures?: FixtureInput[];
  acceptance?: AcceptanceInput;
  retired?: Retirement;
  decidedBy?: string;
};

const requireText = (value: string | undefined, field: string): string => {
  if (value === undefined || value.length === 0) {
    throw new Error(`Rule is missing required field "${field}"`);
  }
  return value;
};

const requireOneOf = <TValue extends string>(
  value: string | undefined,
  allowed: readonly TValue[],
  field: string
): TValue => {
  const text = requireText(value, field);
  const match = allowed.find((candidate) => candidate === text);
  if (match === undefined) {
    throw new Error(
      `Rule field "${field}" must be one of ${allowed.join(
        ", "
      )} but was "${text}"`
    );
  }
  return match;
};

const asProcedure = (input: ProcedureInput): Procedure => {
  const base: Procedure = {
    human: input.human ?? "",
    check: input.check ?? null,
  };
  return input.paths === undefined ? base : { ...base, paths: input.paths };
};

const requireProcedure = (
  input: ProcedureInput | undefined,
  field: string
): Procedure => {
  if (input === undefined) {
    throw new Error(`Rule is missing required field "${field}"`);
  }
  if (typeof input.human !== "string" || input.human.length === 0) {
    throw new Error(
      `Rule field "${field}" must be an object with a human procedure`
    );
  }
  return normaliseProcedure(asProcedure(input));
};

export const optionalSeverity = (
  value: string | undefined
): Severity | undefined =>
  value === undefined || value.length === 0
    ? undefined
    : requireOneOf(value, SEVERITIES, "severity");

export const normaliseRuleInput = (
  rule: RuleInput,
  severityOverride?: Severity
): RuleDraft => ({
  id: requireText(rule.id, "id"),
  aspect: requireText(rule.aspect, "aspect"),
  scope: requireOneOf(rule.scope, SCOPES, "scope"),
  severity:
    severityOverride ?? requireOneOf(rule.severity, SEVERITIES, "severity"),
  mechanization: requireOneOf(
    rule.mechanization,
    MECHANIZATIONS,
    "mechanization"
  ),
  statement: requireText(rule.statement, "statement"),
  rationale: requireText(rule.rationale, "rationale"),
  archaeology: rule.archaeology ?? "",
  appliesWhen: requireProcedure(rule.appliesWhen, "appliesWhen"),
  detect: requireProcedure(rule.detect, "detect"),
  violates: requireProcedure(rule.violates, "violates"),
  rubric: rule.rubric ?? [],
  verdictSpace: rule.verdictSpace ?? [...DEFAULT_VERDICT_SPACE],
  evidence: rule.evidence ?? emptyEvidence(),
  retired: rule.retired ?? null,
});
