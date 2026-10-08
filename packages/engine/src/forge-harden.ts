import path from "node:path";
import { createHash } from "node:crypto";
import { isUsecaseTest, type TestMode } from "./gate-payload.ts";
import type { DoneVector } from "test-forge-contracts/gates";
import type { ForgeScope, Unit } from "./forge-units.ts";
import { isTestPath } from "./test-paths.ts";
import type { PhaseOutcome } from "./types.ts";

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const IMPORT_SPECIFIER = /(?:\bfrom|\bimport|\brequire\(|\bvi\.mock\()\s*["']([^"']+)["']/g;

const TEST_CALL = /\b(?:it|test)(?:\.[a-z]+)*(?:\((?:[^()]|\([^()]*\))*\))?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

const stripExtension = (file: string): string => file.replace(/\.[cm]?[jt]sx?$/, "");

const resolveSpecifier = (testFile: string, specifier: string): string => {
  if (specifier.startsWith("~/")) return stripExtension(`src/${specifier.slice(2)}`);
  if (specifier.startsWith(".")) {
    return stripExtension(
      path.posix.normalize(path.posix.join(path.posix.dirname(testFile), specifier)),
    );
  }
  return stripExtension(specifier);
};

export const digest = (content: string): string => createHash("sha1").update(content).digest("hex");

export const importedSources = (
  testFile: string,
  content: string,
  sources: readonly string[],
): string[] => {
  const imported = new Set(
    [...content.matchAll(IMPORT_SPECIFIER)].map((match) => resolveSpecifier(testFile, match[1] ?? "")),
  );
  return sources.filter((source) => imported.has(stripExtension(source)));
};

const HUB_IMPORTER_LIMIT = 10;

export const existingUnits = (input: {
  sources: readonly string[];
  testFiles: readonly string[];
  scope: ForgeScope;
  read: (file: string) => string;
}): Unit[] => {
  const imports = input.testFiles
    .filter((file) => TEST_FILE.test(file) && isTestPath(file) && isUsecaseTest(file, input.scope))
    .map((file) => ({ file, covered: importedSources(file, input.read(file), input.sources) }));
  const importers = new Map<string, number>();
  for (const { covered } of imports) {
    for (const source of covered) importers.set(source, (importers.get(source) ?? 0) + 1);
  }
  const isHub = (source: string): boolean => (importers.get(source) ?? 0) > HUB_IMPORTER_LIMIT;
  return imports
    .flatMap(({ file, covered }) => {
      const own = covered.filter((source) => !isHub(source));
      return own.length === 0 ? [] : [{ file, sources: own, rows: [], focusLines: [] }];
    })
    .sort((left, right) => left.file.localeCompare(right.file));
};

export const testNames = (content: string): string[] => [
  ...new Set([...content.matchAll(TEST_CALL)].map((match) => match[2] ?? "")),
];

const QUOTES = new Set(["'", '"', "`"]);

const skipQuoted = (content: string, start: number): number => {
  const quote = content[start];
  for (let index = start + 1; index < content.length; index += 1) {
    if (content[index] === "\\") index += 1;
    else if (content[index] === quote) return index;
  }
  return content.length;
};

const closingParen = (content: string, open: number): number => {
  let depth = 0;
  for (let index = open; index < content.length; index += 1) {
    const char = content[index] ?? "";
    if (QUOTES.has(char)) index = skipQuoted(content, index);
    else if (content.startsWith("//", index)) index = content.indexOf("\n", index);
    else if (content.startsWith("/*", index)) index = content.indexOf("*/", index) + 1;
    else if (char === "(") depth += 1;
    else if (char === ")" && (depth -= 1) === 0) return index;
    if (index < 0) return -1;
  }
  return -1;
};

const testBlockOf = (content: string, name: string): { start: number; end: number } | undefined => {
  for (const match of content.matchAll(TEST_CALL)) {
    if (match[2] !== name || match.index === undefined) continue;
    const quoteAt = match.index + match[0].length - name.length - 2;
    const open = content.lastIndexOf("(", quoteAt);
    const close = closingParen(content, open);
    if (close < 0) return undefined;
    const start = content.lastIndexOf("\n", match.index) + 1;
    const lineEnd = content.indexOf("\n", close);
    const end = lineEnd < 0 ? content.length : lineEnd + 1;
    const blank = /^[ \t]*\n/.exec(content.slice(end));
    return { start, end: end + (blank?.[0].length ?? 0) };
  }
  return undefined;
};

export const removeTests = (content: string, names: readonly string[]): { content: string; removed: string[] } =>
  names.reduce(
    (result, name) => {
      const block = testBlockOf(result.content, name);
      return block
        ? {
            content: result.content.slice(0, block.start) + result.content.slice(block.end),
            removed: [...result.removed, name],
          }
        : result;
    },
    { content, removed: [] as string[] },
  );

const OUTLINE_LINE =
  /^\s*(?:import\b|export\b|(?:const|let|function|async function|class)\s|describe\b|it\b|test\b|(?:before|after)(?:Each|All)\b|vi\.mock\b)/;
const OUTLINE_LIMIT = 400;
const OUTLINE_WIDTH = 140;

export const testOutline = (content: string): string =>
  content
    .split("\n")
    .flatMap((line, index) => (OUTLINE_LINE.test(line) ? [`${index + 1}: ${line.trim().slice(0, OUTLINE_WIDTH)}`] : []))
    .slice(0, OUTLINE_LIMIT)
    .join("\n");

export type TestBaseline = Record<string, { names: string[]; hash: string }>;

export const baselineOf = (
  files: readonly string[],
  read: (file: string) => string,
): TestBaseline =>
  Object.fromEntries(
    files.map((file) => {
      const content = read(file);
      return [file, { names: testNames(content), hash: digest(content) }];
    }),
  );

export const protectedTestsOf = (baseline: TestBaseline, file: string): string[] =>
  baseline[file]?.names ?? [];

export const removedProtectedTests = (
  baseline: TestBaseline,
  read: (file: string) => string,
): { file: string; names: string[] }[] =>
  Object.entries(baseline).flatMap(([file, entry]) => {
    const remaining = new Set(testNames(read(file)));
    const names = entry.names.filter((name) => !remaining.has(name));
    return names.length > 0 ? [{ file, names }] : [];
  });

export const changedTestFiles = (
  baseline: TestBaseline,
  read: (file: string) => string,
): string[] =>
  Object.entries(baseline)
    .filter(([file, entry]) => digest(read(file)) !== entry.hash)
    .map(([file]) => file);

export const mapperFailure = (outcome: PhaseOutcome): string | undefined =>
  outcome.result?.status === "delivered"
    ? undefined
    : `The mapper ended with ${outcome.result?.summary ?? outcome.summary} and no accepted handoff.`;

const HARDEN_PREDICATES = ["D1", "D2", "D3", "D4", "D5", "D6", "D10"] as const;

const HARDEN_NOT_USED = ["D7", "D8", "D9"] as const;

export type ExitDecision = {
  exitKind: "DONE" | "BLOCKED" | "STALLED";
  failing: string[];
  notUsed: string[];
};

export const exitDecision = (input: {
  mode: TestMode;
  predicates: DoneVector;
  stalled: boolean;
  hasBlocker: boolean;
}): ExitDecision => {
  const counted: readonly string[] =
    input.mode === "harden"
      ? HARDEN_PREDICATES
      : [...HARDEN_PREDICATES, ...HARDEN_NOT_USED];
  const failing = Object.entries(input.predicates)
    .filter(([id, value]) => !value && counted.includes(id.toUpperCase()))
    .map(([id]) => id.toUpperCase());
  const exitKind = input.hasBlocker
    ? "BLOCKED"
    : failing.length === 0
      ? "DONE"
      : input.stalled
        ? "STALLED"
        : "BLOCKED";
  return { exitKind, failing, notUsed: input.mode === "harden" ? [...HARDEN_NOT_USED] : [] };
};
