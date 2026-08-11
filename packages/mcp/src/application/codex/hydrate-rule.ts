import { normaliseProcedure } from "../../domain/codex/check-expression.ts";
import {
  DEFAULT_VERDICT_SPACE,
  emptyEvidence,
  readRetirement,
} from "../../domain/codex/rule.ts";
import {
  readAcceptance,
  readFixtures,
} from "../../infrastructure/db/codex-store.ts";
import type { CodexVersionRow } from "../../infrastructure/db/rows.ts";
import type { DatabaseSync } from "node:sqlite";
import type {
  Acceptance,
  Evidence,
  Fixture,
  Procedure,
  RubricItem,
  RuleVersion,
  Verdict,
} from "test-forge-contracts/codex";

const parseJson = <TValue>(value: string, fallback: TValue): TValue => {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed as TValue;
  } catch {
    return fallback;
  }
};

const emptyProcedure = (): Procedure => ({ human: "", check: null });

export const toRuleVersion = (
  row: CodexVersionRow,
  fixtures: Fixture[],
  acceptance: Acceptance | null
): RuleVersion => ({
  id: row.rule_id,
  version: row.version,
  aspect: row.aspect,
  scope: row.scope,
  severity: row.severity,
  mechanization: row.mechanization,
  statement: row.statement,
  rationale: row.rationale,
  archaeology: row.archaeology,
  appliesWhen: normaliseProcedure(
    parseJson<Procedure>(row.applies_when_json, emptyProcedure())
  ),
  detect: normaliseProcedure(
    parseJson<Procedure>(row.detect_json, emptyProcedure())
  ),
  violates: normaliseProcedure(
    parseJson<Procedure>(row.violates_json, emptyProcedure())
  ),
  rubric: parseJson<RubricItem[]>(row.rubric_json, []),
  verdictSpace: parseJson<Verdict[]>(row.verdict_space_json, [
    ...DEFAULT_VERDICT_SPACE,
  ]),
  evidence: parseJson<Evidence>(row.evidence_json, emptyEvidence()),
  decidedBy: row.decided_by,
  createdAt: row.created_at,
  retired: readRetirement(row.retired_at, row.retired_reason),
  fixtures,
  acceptance,
});

export const hydrateRule = (
  db: DatabaseSync,
  projectKey: string,
  row: CodexVersionRow
): RuleVersion =>
  toRuleVersion(
    row,
    readFixtures(db, projectKey, row.rule_id),
    readAcceptance(db, projectKey, row.rule_id, row.version)
  );
