import type {
  CheckExpression,
  Procedure,
  ProcedurePaths,
} from "test-forge-contracts/codex";

export const NO_CHECK_REASON =
  "The rule carries no mechanical check, so the aspect sentence and the rubric decide.";

export const NO_FILE_PATH_REASON =
  "No file path was supplied, so the check could not be run.";

export type CheckSite = { line: number; quote: string };

export type CheckEvaluation =
  | {
      evaluable: true;
      by: string;
      matched: boolean;
      expression?: string;
      sites: readonly CheckSite[];
      reason: string;
    }
  | { evaluable: false; expression?: string; reason: string };

export type ParsedCheck =
  | {
      form: "grep";
      canonical: string;
      pattern: string;
      source: string;
      flags: string;
    }
  | { form: "expression"; canonical: string; expression: string }
  | { form: "none"; reason: string }
  | { form: "unparseable"; reason: string; original: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringAt = (
  record: Record<string, unknown>,
  key: string
): string | null => {
  const value = record[key];
  return typeof value === "string" ? value : null;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

const escapeRegexSlashes = (pattern: string): string =>
  pattern.replace(/\\[\s\S]|\//g, (token) => (token === "/" ? "\\/" : token));

const GREP_DELIMITED = /^\/([\s\S]*)\/([a-z]*)$/;

const canonicalOfStored = (
  check: Record<string, unknown>
): ParsedCheck | null => {
  const kind = stringAt(check, "kind");
  if (kind === null || kind === "none") {
    return { form: "none", reason: NO_CHECK_REASON };
  }
  if (kind !== "grep") {
    return {
      form: "unparseable",
      original: check,
      reason: `The stored check kind "${kind}" has no form in the check DSL. Rewrite it as "grep:<pattern>" or an "ast:<expression>".`,
    };
  }
  const pattern = stringAt(check, "pattern");
  if (pattern === null || pattern.length === 0) {
    return {
      form: "unparseable",
      original: check,
      reason:
        "The stored grep check carries no pattern, so there is nothing to run.",
    };
  }
  if (/[\r\n]/.test(pattern)) {
    return {
      form: "unparseable",
      original: check,
      reason:
        "The stored grep pattern spans a line break, which the check DSL cannot express. Rewrite it as an ast: expression.",
    };
  }
  return null;
};

const canonicalStringOfStored = (check: Record<string, unknown>): string => {
  const pattern = stringAt(check, "pattern") ?? "";
  return stringAt(check, "expect") === "no-match"
    ? `ast:none(rawText(/${escapeRegexSlashes(pattern)}/))`
    : `grep:${pattern}`;
};

export const splitCheck = (
  raw: string
): { kind: "grep" | "ast"; body: string } => {
  const value = raw.trim();
  if (value.startsWith("ast:"))
    return { kind: "ast", body: value.slice(4).trim() };
  if (value.startsWith("grep:"))
    return { kind: "grep", body: value.slice(5).trim() };
  return { kind: "ast", body: value };
};

const parseDslString = (canonical: string): ParsedCheck => {
  const part = splitCheck(canonical);
  if (part.kind === "ast") {
    return { form: "expression", canonical, expression: part.body };
  }
  const delimited = GREP_DELIMITED.exec(part.body.trim());
  return {
    form: "grep",
    canonical,
    pattern: part.body,
    source: delimited === null ? part.body : delimited[1] ?? "",
    flags: delimited === null ? "" : delimited[2] ?? "",
  };
};

export const parseCheck = (check: unknown): ParsedCheck => {
  if (check === undefined || check === null) {
    return { form: "none", reason: NO_CHECK_REASON };
  }
  if (typeof check === "string") {
    const trimmed = check.trim();
    return trimmed.length === 0
      ? { form: "none", reason: NO_CHECK_REASON }
      : parseDslString(trimmed);
  }
  if (!isRecord(check)) {
    return {
      form: "unparseable",
      original: check,
      reason: `A check must be a check-DSL string, but this one is a ${typeof check}.`,
    };
  }
  return (
    canonicalOfStored(check) ?? parseDslString(canonicalStringOfStored(check))
  );
};

export const canonicalCheck = (
  check: CheckExpression | undefined
): CheckExpression => {
  if (check === undefined || check === null) return null;
  const parsed = parseCheck(check);
  if (parsed.form === "grep" || parsed.form === "expression") {
    return parsed.canonical;
  }
  if (parsed.form === "none" || typeof check === "string") return null;
  return check;
};

export const unrunnableEvaluation = (
  parsed: ParsedCheck
): CheckEvaluation | null =>
  parsed.form === "none" || parsed.form === "unparseable"
    ? { evaluable: false, reason: parsed.reason }
    : null;

export const notEvaluable = (reason: string): CheckEvaluation => ({
  evaluable: false,
  reason,
});

export const notEvaluableExpression = (
  expression: string,
  reason: string
): CheckEvaluation => ({ evaluable: false, expression, reason });

export const pathsOf = (
  procedure: Procedure | null | undefined
): ProcedurePaths | null => {
  const check: unknown = procedure?.check;
  const source: unknown = procedure?.paths ?? (isRecord(check) ? check : null);
  const include = stringArray(isRecord(source) ? source["include"] : null);
  const exclude = stringArray(isRecord(source) ? source["exclude"] : null);
  return include.length === 0 && exclude.length === 0
    ? null
    : { include, exclude };
};

export const normaliseProcedure = (
  procedure: Procedure | null | undefined
): Procedure => {
  const paths = pathsOf(procedure);
  const normalised: Procedure = {
    human: procedure?.human ?? "",
    check: canonicalCheck(procedure?.check),
  };
  return paths === null ? normalised : { ...normalised, paths };
};
