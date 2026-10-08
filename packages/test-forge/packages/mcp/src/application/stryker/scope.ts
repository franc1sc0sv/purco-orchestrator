import {
  isProductionSource,
  isTestFile,
  parseChangedLines,
  wholeFileRange,
} from "../../domain/stryker/diff.ts";
import {
  isSelected,
  overlapsChangedLine,
  projectKindOf,
} from "../../domain/stryker/scope.ts";
import { readTextFile } from "../../infrastructure/files.ts";
import {
  diffAgainstCommit,
  mergeBaseWith,
  repoRoot,
  untrackedFiles,
} from "../../infrastructure/git.ts";
import { recoverBackups } from "../../infrastructure/solo-backup.ts";
import { listMutantSites } from "../../infrastructure/stryker-instrument.ts";
import type { InstrumentedFile } from "../../infrastructure/stryker-instrument.ts";
import { relatedTestFiles } from "./related-tests.ts";
import { join } from "node:path";
import { PROJECT_KINDS } from "test-forge-contracts/stryker";
import type {
  ChangedLines,
  InstrumentFailure,
  MutantSite,
  ProjectKind,
  ScopeRule,
  ScopeSelection,
  StrykerScopeResult,
} from "test-forge-contracts/stryker";

export type StrykerScopeInput = {
  cwd: string;
  base: string;
  files?: readonly string[] | undefined;
  testFiles?: readonly string[] | undefined;
  scopeRule?: ScopeRule | undefined;
  hubImporterLimit?: number | undefined;
};

export type ResolvedScope = {
  root: string;
  changed: ChangedLines;
  instrumented: InstrumentedFile[];
  baseRef: string;
  mergeBase: string;
  scopeRule: ScopeRule;
  selections: ScopeSelection[];
  instrumentFailures: InstrumentFailure[];
  selectionMs: number;
};

export type ScopeResolution =
  | ({ ok: true } & ResolvedScope)
  | { ok: false; reason: string };

export const DEFAULT_SCOPE_RULE: ScopeRule = "span-overlap";

const baseRefOf = (base: string): string =>
  base.startsWith("origin/") ? base : `origin/${base}`;

const changedLinesOf = async (
  root: string,
  mergeBase: string,
): Promise<ChangedLines> => {
  const changed = parseChangedLines(await diffAgainstCommit(root, mergeBase));
  for (const path of await untrackedFiles(root)) {
    const text = readTextFile(join(root, path));
    if (text !== null) changed[path] = [wholeFileRange(text)];
  }
  return changed;
};

const existsOnDisk = (root: string, path: string): boolean =>
  readTextFile(join(root, path)) !== null;

const sitesOf = (
  instrumented: readonly { file: string; sites: MutantSite[] }[],
  changed: ChangedLines,
  rule: ScopeRule,
): { inScope: MutantSite[]; overlapOnly: MutantSite[] } => {
  const inScope: MutantSite[] = [];
  const overlapOnly: MutantSite[] = [];
  for (const { file, sites } of instrumented) {
    const ranges = changed[file] ?? [];
    for (const site of sites) {
      if (isSelected(rule, site, ranges)) inScope.push(site);
      else if (overlapsChangedLine(site, ranges)) overlapOnly.push(site);
    }
  }
  return { inScope, overlapOnly };
};

const selectionOf = (
  kind: ProjectKind,
  files: readonly string[],
  testFiles: readonly string[],
  instrumented: readonly { file: string; sites: MutantSite[] }[],
  changed: ChangedLines,
  rule: ScopeRule,
): ScopeSelection => {
  const { inScope, overlapOnly } = sitesOf(instrumented, changed, rule);
  const hasTests = testFiles.length > 0;
  return {
    kind,
    files: [...files],
    testFiles: [...testFiles],
    inScope: hasTests ? inScope : [],
    overlapOnly,
    uncovered: hasTests ? [] : inScope,
  };
};

export const resolveScope = async ({
  cwd,
  base,
  files,
  testFiles,
  scopeRule = DEFAULT_SCOPE_RULE,
  hubImporterLimit,
}: StrykerScopeInput): Promise<ScopeResolution> => {
  const startedAt = Date.now();
  const root = await repoRoot(cwd);
  recoverBackups(root);
  const baseRef = baseRefOf(base);
  const mergeBase = await mergeBaseWith(root, baseRef);
  if (mergeBase === null) {
    return {
      ok: false,
      reason: `no merge base between HEAD and ${baseRef}; fetch ${baseRef} first`,
    };
  }
  const changed = await changedLinesOf(root, mergeBase);
  const allowed = files === undefined ? null : new Set(files);
  const productionFiles = Object.keys(changed)
    .filter(isProductionSource)
    .filter((path) => allowed === null || allowed.has(path))
    .filter((path) => existsOnDisk(root, path))
    .sort();
  const changedTests = Object.keys(changed).filter(isTestFile);
  const tests =
    testFiles === undefined
      ? await relatedTestFiles(root, productionFiles, changedTests, hubImporterLimit)
      : [...testFiles];
  const instrumented = await listMutantSites(root, productionFiles);
  const selections = PROJECT_KINDS.map((kind) => {
    const kindFiles = productionFiles.filter(
      (path) => projectKindOf(path) === kind,
    );
    const kindSites = instrumented.filter(
      (entry) => projectKindOf(entry.file) === kind,
    );
    const kindTests = tests.filter((path) => projectKindOf(path) === kind);
    return selectionOf(kind, kindFiles, kindTests, kindSites, changed, scopeRule);
  }).filter((selection) => selection.files.length > 0);
  return {
    ok: true,
    root,
    changed,
    instrumented,
    baseRef,
    mergeBase,
    scopeRule,
    selections,
    instrumentFailures: instrumented.flatMap((entry) =>
      entry.error === null ? [] : [{ file: entry.file, error: entry.error }],
    ),
    selectionMs: Date.now() - startedAt,
  };
};

export const strykerScope = async (
  input: StrykerScopeInput,
): Promise<StrykerScopeResult> => {
  const resolved = await resolveScope(input);
  if (!resolved.ok) return resolved;
  const { selections, instrumentFailures } = resolved;
  return {
    ok: true,
    baseRef: resolved.baseRef,
    mergeBase: resolved.mergeBase,
    scopeRule: resolved.scopeRule,
    selections,
    inScope: selections.reduce(
      (total, selection) =>
        total + selection.inScope.length + selection.uncovered.length,
      0,
    ),
    overlapOnly: selections.reduce(
      (total, selection) => total + selection.overlapOnly.length,
      0,
    ),
    instrumentFailures,
    selectionMs: resolved.selectionMs,
  };
};
