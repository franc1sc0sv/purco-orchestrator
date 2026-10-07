import {
  buildEnumIndex,
  collectLiteralPool,
  countByOperator,
  mutantKey,
  mutateLine,
} from "../../domain/mutation/operators.ts";
import type { OperatorCounts } from "../../domain/mutation/operators.ts";
import { genericDepthAfter } from "../../domain/mutation/syntax.ts";
import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import {
  SOURCE_EXTENSIONS,
  readTextFile,
  readableFile,
} from "../../infrastructure/files.ts";
import { repoRoot } from "../../infrastructure/git.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { dirname, join, relative, sep } from "node:path";
import type { Mutant } from "test-forge-contracts/mutation";

export type LineRange = readonly [number, number];

export type MutationGenerateInput = {
  cwd: string;
  files: readonly string[];
  runId?: number | undefined;
  lines?: Readonly<Record<string, readonly LineRange[]>> | undefined;
};

export type MutationGenerateResult = {
  mutants: Mutant[];
  counts: OperatorCounts;
  persisted: boolean;
};

type MutantIdRow = { id: number };

const toRepoRelative = (root: string, path: string): string =>
  (path.startsWith(root) ? relative(root, path) : path).split(sep).join("/");

const resolveImport = (
  root: string,
  fromPath: string,
  specifier: string,
): string | null => {
  let base: string;
  if (specifier.startsWith(".")) base = join(dirname(fromPath), specifier);
  else if (specifier.startsWith("~/") || specifier.startsWith("@/"))
    base = join("src", specifier.slice(2));
  else return null;
  const candidates = [
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    const found = readableFile(root, candidate);
    if (found !== null) return found;
  }
  return null;
};

const importedTexts = (
  root: string,
  sources: ReadonlyMap<string, string>,
): string[] => {
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const [target, text] of sources) {
    for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      const resolved = resolveImport(root, target, match[1] ?? "");
      if (resolved === null || seen.has(resolved)) continue;
      seen.add(resolved);
      const imported = readTextFile(resolved);
      if (imported !== null) texts.push(imported);
    }
  }
  return texts;
};

const readTargets = (
  root: string,
  files: readonly string[],
): Map<string, string> => {
  const sources = new Map<string, string>();
  for (const file of files) {
    const target = toRepoRelative(root, file);
    const text = readTextFile(join(root, target));
    if (text !== null) sources.set(target, text);
  }
  return sources;
};

const persist = async (
  root: string,
  runId: number,
  mutants: readonly Mutant[],
): Promise<Mutant[]> => {
  const db = openDb();
  const projectKey = await projectKeyOf(root);
  return tx(db, (txScope) =>
    mutants.map((mutant) => {
      const existing = one<MutantIdRow>(
        txScope.db,
        "SELECT id FROM mutants WHERE run_id = ? AND file_path = ? AND line = ? AND operator = ? AND after_text = ?",
        [runId, mutant.file, mutant.line, mutant.operator, mutant.after],
      );
      if (existing) return { ...mutant, id: existing.id };
      const inserted = run(
        txScope.db,
        "INSERT INTO mutants (project_key, run_id, file_path, line, operator, before_text, after_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          projectKey,
          runId,
          mutant.file,
          mutant.line,
          mutant.operator,
          mutant.before,
          mutant.after,
        ],
      );
      return { ...mutant, id: Number(inserted.lastInsertRowid) };
    }),
  );
};

const inRanges = (
  ranges: readonly LineRange[] | undefined,
  lineNo: number,
): boolean =>
  ranges === undefined ||
  ranges.some(([start, end]) => lineNo >= start && lineNo <= end);

export const mutationGenerate = async ({
  cwd,
  files,
  runId,
  lines: changedLines,
}: MutationGenerateInput): Promise<MutationGenerateResult> => {
  const root = await repoRoot(cwd);
  const sources = readTargets(root, files);
  const rangesOf = (target: string): readonly LineRange[] | undefined =>
    changedLines === undefined ? undefined : (changedLines[target] ?? []);
  const texts = [...sources.values()];
  const enums = buildEnumIndex([...texts, ...importedTexts(root, sources)]);
  const literals = collectLiteralPool(texts);

  const mutants: Mutant[] = [];
  const seen = new Set<string>();
  for (const [target, text] of sources) {
    const lines = text.split("\n");
    const ranges = rangesOf(target);
    let openGenericDepth = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined) continue;
      const context = {
        openGenericDepth,
        nextLine: lines[index + 1],
        enums,
        literals,
      };
      openGenericDepth = genericDepthAfter(line, openGenericDepth);
      if (!inRanges(ranges, index + 1)) continue;
      for (const mutation of mutateLine(line, context)) {
        const key = mutantKey(target, index + 1, mutation);
        if (seen.has(key)) continue;
        seen.add(key);
        mutants.push({
          file: target,
          line: index + 1,
          operator: mutation.operator,
          before: line,
          after: mutation.after,
        });
      }
    }
  }

  if (runId === undefined) {
    return { mutants, counts: countByOperator(mutants), persisted: false };
  }

  const persisted = await persist(root, runId, mutants);
  return {
    mutants: persisted,
    counts: countByOperator(persisted),
    persisted: true,
  };
};
