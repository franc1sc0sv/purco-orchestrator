import {
  importDecider,
  importedSeverity,
  importOrigin,
} from "../../domain/codex/rule.ts";
import {
  appendVersion,
  insertFixtures,
  insertTaxonomyExtIfAbsent,
} from "../../infrastructure/db/codex-store.ts";
import { openDb, tx } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { normaliseRuleInput, optionalSeverity } from "./rule-input.ts";
import type { RuleInput } from "./rule-input.ts";
import type { Severity } from "test-forge-contracts/codex";

export type ImportCodexInput = {
  cwd: string;
  payload: unknown;
  markAdvisory?: boolean | undefined;
};

export type ImportedRule = {
  ruleId: string;
  version: number;
  severity: Severity;
};

export type ImportCodexResult = {
  projectKey: string;
  origin: string;
  markAdvisory: boolean;
  aspectsAdded: number;
  rulesImported: number;
  rules: ImportedRule[];
};

type AspectPayload = {
  id?: string;
  aspect?: string;
  scope?: string;
  appliesWhen?: string;
  blockingBar?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsePayload = (payload: unknown): unknown => {
  if (typeof payload !== "string") return payload;
  const parsed: unknown = JSON.parse(payload);
  return parsed;
};

const rulesOf = (parsed: unknown): RuleInput[] => {
  if (Array.isArray(parsed)) return parsed as RuleInput[];
  if (!isRecord(parsed)) return [];
  const rules = parsed["rules"];
  return Array.isArray(rules) ? (rules as RuleInput[]) : [];
};

const aspectsOf = (parsed: unknown): AspectPayload[] => {
  if (!isRecord(parsed)) return [];
  const aspects = parsed["aspects"];
  return Array.isArray(aspects) ? (aspects as AspectPayload[]) : [];
};

const originOf = (parsed: unknown): string => {
  if (!isRecord(parsed)) return importOrigin(null);
  const project = parsed["project"];
  if (!isRecord(project)) return importOrigin(null);
  const key = project["key"];
  return importOrigin(typeof key === "string" ? key : null);
};

export const importCodex = async ({
  cwd,
  payload,
  markAdvisory = true,
}: ImportCodexInput): Promise<ImportCodexResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const parsed = parsePayload(payload);
  const rules = rulesOf(parsed);
  const aspects = aspectsOf(parsed);
  const origin = originOf(parsed);

  return tx(db, (txScope) => {
    let aspectsAdded = 0;
    for (const aspect of aspects) {
      aspectsAdded += insertTaxonomyExtIfAbsent(
        txScope.db,
        projectKey,
        aspect.scope ?? "",
        aspect.id ?? aspect.aspect ?? "",
        aspect.appliesWhen ?? "",
        aspect.blockingBar ?? "majority",
      );
    }

    const imported: ImportedRule[] = [];
    for (const rule of rules) {
      const severity = importedSeverity(
        optionalSeverity(rule.severity),
        markAdvisory,
      );
      const draft = normaliseRuleInput(rule, severity);
      const written = appendVersion(
        txScope.db,
        projectKey,
        draft,
        importDecider(origin),
      );
      insertFixtures(txScope.db, projectKey, draft.id, rule.fixtures ?? []);
      imported.push({
        ruleId: draft.id,
        version: written.version,
        severity,
      });
    }

    return {
      projectKey,
      origin,
      markAdvisory,
      aspectsAdded,
      rulesImported: imported.length,
      rules: imported,
    };
  });
};
