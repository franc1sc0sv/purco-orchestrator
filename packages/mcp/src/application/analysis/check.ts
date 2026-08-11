import {
  CheckError,
  evaluateCheck,
  MAX_SITES,
  truth,
} from "../../domain/analysis/expression.ts";
import type {
  EvaluationContext,
  ModuleResolution,
} from "../../domain/analysis/helper-resolution.ts";
import { scanSource } from "../../domain/analysis/source-facts.ts";
import { splitCheck } from "../../domain/codex/check-expression.ts";
import {
  absolutePath,
  MAX_FILE_BYTES,
  readTextFile,
  SOURCE_EXTENSIONS,
  hashText,
} from "../../infrastructure/files.ts";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  CheckOutcome,
  FileCheckReport,
} from "test-forge-contracts/analysis";

export type CheckRequest = {
  checkId?: string;
  ruleId?: string;
  check?: string;
  expression?: string;
  detect?: string;
  violates?: string;
  appliesWhen?: string;
};

export type CheckInput = string | CheckRequest;

export type AstCheckOptions = {
  cwd: string;
  filePath: string;
  checks: readonly CheckInput[] | CheckInput;
};

type NormalisedCheck = {
  checkId: string;
  check: string | null;
  appliesWhen: string | null;
};

const normalise = (
  checks: readonly CheckInput[] | CheckInput
): NormalisedCheck[] => {
  const list = Array.isArray(checks) ? checks : [checks];
  return list.map((entry, position) => {
    const fallbackId = `check-${position + 1}`;
    if (typeof entry === "string") {
      return { checkId: fallbackId, check: entry, appliesWhen: null };
    }
    return {
      checkId: entry.checkId ?? entry.ruleId ?? fallbackId,
      check:
        entry.check ??
        entry.expression ??
        entry.detect ??
        entry.violates ??
        null,
      appliesWhen: entry.appliesWhen ?? null,
    };
  });
};

const notEvaluable = (
  checkId: string,
  kind: "ast" | "grep" | null,
  expression: string | null,
  error: string
): CheckOutcome => ({
  checkId,
  kind,
  expression,
  evaluable: false,
  applied: false,
  violated: false,
  sites: [],
  siteCount: 0,
  sitesTruncated: false,
  error,
});

const isAliased = (specifier: string): boolean =>
  /^[~#]/.test(specifier) || specifier.startsWith("@/");

const packageRoot = (specifier: string): string =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0] ?? "";

const candidateBases = (
  cwd: string,
  specifier: string,
  fromPath: string
): string[] => {
  if (specifier.startsWith(".")) return [resolve(dirname(fromPath), specifier)];
  const rooted = specifier.replace(/^[~#]\/?/, "").replace(/^@\//, "");
  return [resolve(cwd, rooted), resolve(cwd, "src", rooted)];
};

const fileCandidates = (base: string): string[] => [
  base,
  ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
  ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
];

const resolveModule = (
  cwd: string,
  specifier: string,
  fromPath: string
): ModuleResolution => {
  for (const base of candidateBases(cwd, specifier, fromPath)) {
    if (base.split(sep).includes("node_modules")) continue;
    for (const candidate of fileCandidates(base)) {
      const source = readTextFile(candidate);
      if (source !== null && source.length <= MAX_FILE_BYTES) {
        return { kind: "file", path: candidate, source };
      }
    }
  }
  const isPackage =
    !specifier.startsWith(".") &&
    !isAliased(specifier) &&
    existsSync(join(cwd, "node_modules", packageRoot(specifier)));
  return isPackage ? { kind: "package" } : { kind: "missing" };
};

const messageOf = (error: unknown): string =>
  error instanceof CheckError || error instanceof Error
    ? error.message
    : String(error);

export const astCheck = ({
  cwd,
  filePath,
  checks,
}: AstCheckOptions): FileCheckReport => {
  const absolute = absolutePath(cwd, filePath);
  const source = readTextFile(absolute);
  if (source === null) {
    throw new Error(`cannot read the file to check: ${absolute}`);
  }
  const facts = scanSource(source);
  const context: EvaluationContext = {
    filePath: absolute,
    resolveModule: (specifier, fromPath) =>
      resolveModule(cwd, specifier, fromPath),
  };

  const results = normalise(checks).map((entry): CheckOutcome => {
    if (entry.check === null) {
      return notEvaluable(entry.checkId, null, null, "check has no expression");
    }
    const part = splitCheck(entry.check);
    try {
      const applied =
        entry.appliesWhen === null
          ? true
          : truth(evaluateCheck(entry.appliesWhen, facts, context));
      if (!applied) {
        return {
          checkId: entry.checkId,
          kind: part.kind,
          expression: part.body,
          evaluable: true,
          applied: false,
          violated: false,
          sites: [],
          siteCount: 0,
          sitesTruncated: false,
          error: null,
        };
      }
      const value = evaluateCheck(entry.check, facts, context);
      return {
        checkId: entry.checkId,
        kind: part.kind,
        expression: part.body,
        evaluable: true,
        applied: true,
        violated: truth(value),
        sites: value.sites
          .slice(0, MAX_SITES)
          .map(({ line, quote }) => ({ line, quote })),
        siteCount: value.sites.length,
        sitesTruncated: value.sites.length > MAX_SITES,
        error: null,
      };
    } catch (error) {
      return notEvaluable(
        entry.checkId,
        part.kind,
        part.body,
        messageOf(error)
      );
    }
  });

  return {
    filePath: relative(cwd, absolute),
    fileHash: hashText(source),
    checks: results,
    appliedCount: results.filter((result) => result.applied).length,
    violatedCount: results.filter((result) => result.violated).length,
    erroredCount: results.filter((result) => result.error !== null).length,
  };
};
