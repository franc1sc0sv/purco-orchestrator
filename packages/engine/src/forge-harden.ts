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

const digest = (content: string): string => createHash("sha1").update(content).digest("hex");

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

export const existingUnits = (input: {
  sources: readonly string[];
  testFiles: readonly string[];
  scope: ForgeScope;
  read: (file: string) => string;
}): Unit[] =>
  input.testFiles
    .filter((file) => TEST_FILE.test(file) && isTestPath(file) && isUsecaseTest(file, input.scope))
    .flatMap((file) => {
      const covered = importedSources(file, input.read(file), input.sources);
      return covered.length === 0 ? [] : [{ file, sources: covered, rows: [], focusLines: [] }];
    })
    .sort((left, right) => left.file.localeCompare(right.file));

export const testNames = (content: string): string[] => [
  ...new Set([...content.matchAll(TEST_CALL)].map((match) => match[2] ?? "")),
];

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
