import { hashFile, hashText, readTextFile } from "./files.ts";
import {
  addWorktree,
  applyPatch,
  diffAgainstHead,
  pruneWorktrees,
  removeWorktree,
  resetTrackedFiles,
  untrackedFiles,
} from "./git.ts";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

export type PreparedWorktree =
  | { ok: true; path: string; patchFile: string; warnings: string[] }
  | { ok: false; reason: string; warnings: string[] };

const ENV_FILES_TO_CARRY = [
  ".env",
  ".env.test",
  ".env.local",
  ".env.development",
];

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const realPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export const toRepoRelative = (root: string, path: string): string =>
  (isAbsolute(path) ? relative(realPath(root), realPath(path)) : path)
    .split(sep)
    .join("/");

const carryUntrackedFiles = async (
  root: string,
  worktree: string,
): Promise<string[]> => {
  const problems: string[] = [];
  for (const relativePath of await untrackedFiles(root)) {
    try {
      const destination = join(worktree, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, relativePath), destination);
    } catch (error) {
      problems.push(`could not carry ${relativePath}: ${messageOf(error)}`);
    }
  }
  for (const envFile of ENV_FILES_TO_CARRY) {
    const source = join(root, envFile);
    if (!existsSync(source)) continue;
    try {
      copyFileSync(source, join(worktree, envFile));
    } catch (error) {
      problems.push(`could not carry ${envFile}: ${messageOf(error)}`);
    }
  }
  return problems;
};

const linkNodeModules = (root: string, worktree: string): string | null => {
  if (existsSync(join(worktree, "node_modules"))) return null;
  try {
    symlinkSync(
      join(root, "node_modules"),
      join(worktree, "node_modules"),
      "dir",
    );
    return null;
  } catch (error) {
    return messageOf(error);
  }
};

export const workingTreeFingerprint = async (root: string): Promise<string> => {
  const diff = await diffAgainstHead(root);
  const untracked = (await untrackedFiles(root))
    .sort()
    .map((path) => `${path}:${hashFile(join(root, path)) ?? "missing"}`)
    .join("\n");
  return hashText(`${diff}\n---\n${untracked}`);
};

const replayWorkingTree = async (
  root: string,
  worktree: string,
  patchFile: string,
): Promise<string | null> => {
  const diff = await diffAgainstHead(root);
  if (diff.trim() === "") return null;
  writeFileSync(patchFile, diff);
  const applied = await applyPatch(worktree, patchFile);
  return applied.ok
    ? null
    : `could not replay working tree: ${applied.stderr.trim()}`;
};

export const refreshWorktree = async (
  root: string,
  worktree: string,
): Promise<PreparedWorktree> => {
  const patchFile = `${worktree}.patch`;
  const reset = await resetTrackedFiles(worktree);
  if (!reset.ok) {
    return {
      ok: false,
      warnings: [],
      reason: `could not reset the lane to HEAD: ${reset.stderr.trim()}`,
    };
  }
  const replayed = await replayWorkingTree(root, worktree, patchFile);
  if (replayed !== null) return { ok: false, warnings: [], reason: replayed };
  return {
    ok: true,
    path: worktree,
    patchFile,
    warnings: await carryUntrackedFiles(root, worktree),
  };
};

export const prepareWorktree = async (
  root: string,
  worktree: string,
): Promise<PreparedWorktree> => {
  const patchFile = `${worktree}.patch`;
  const warnings: string[] = [];
  const added = await addWorktree(root, worktree);
  if (!added.ok) {
    return {
      ok: false,
      warnings,
      reason: `worktree add failed: ${added.stderr.trim()}`,
    };
  }
  const replayed = await replayWorkingTree(root, worktree, patchFile);
  if (replayed !== null) return { ok: false, warnings, reason: replayed };
  warnings.push(...(await carryUntrackedFiles(root, worktree)));
  const linkFailure = linkNodeModules(root, worktree);
  if (linkFailure !== null) {
    return {
      ok: false,
      warnings,
      reason: `could not link node_modules into the worktree, so the runner can resolve no module: ${linkFailure}`,
    };
  }
  return { ok: true, path: worktree, patchFile, warnings };
};

export const discardWorktree = async (
  root: string,
  worktree: string,
  patchFile: string,
): Promise<void> => {
  await removeWorktree(root, worktree);
  rmSync(worktree, { recursive: true, force: true });
  rmSync(patchFile, { force: true });
  await pruneWorktrees(root);
};

export type LineSwap =
  | { ok: true; previous: string }
  | { ok: false; reason: string; expected: string; found: string | null };

export const swapLine = (
  targetPath: string,
  line: number,
  expected: string,
  replacement: string,
): LineSwap => {
  const source = readTextFile(targetPath);
  if (source === null) {
    return {
      ok: false,
      reason: `file missing in worktree: ${targetPath}`,
      expected,
      found: null,
    };
  }
  const lines = source.split("\n");
  const current = lines[line - 1];
  if (current !== expected) {
    return {
      ok: false,
      reason: `line ${line} of ${targetPath} no longer matches the recorded source`,
      expected,
      found: current ?? null,
    };
  }
  lines[line - 1] = replacement;
  writeFileSync(targetPath, lines.join("\n"));
  return { ok: true, previous: current };
};
