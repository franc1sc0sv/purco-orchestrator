import { runProcess } from "./process.ts";
import { resolve } from "node:path";

export type GitResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

export type Commit = {
  hash: string;
  author: string;
  date: string;
  subject: string;
};

const FIELD_SEPARATOR = "\u001F";

const LOG_FORMAT = "--format=%H%x1f%an%x1f%aI%x1f%s";

export const git = async (
  cwd: string,
  args: readonly string[],
): Promise<GitResult> => {
  const result = await runProcess({ command: "git", args, cwd });
  return {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const output = async (
  cwd: string,
  args: readonly string[],
): Promise<string> => {
  const result = await git(cwd, args);
  return result.ok ? result.stdout.trim() : "";
};

export const repoRoot = async (cwd: string): Promise<string> =>
  (await output(cwd, ["rev-parse", "--show-toplevel"])) || resolve(cwd);

export const remoteUrl = (cwd: string): Promise<string> =>
  output(cwd, ["config", "--get", "remote.origin.url"]);

export const untrackedFiles = async (cwd: string): Promise<string[]> => {
  const listed = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  if (!listed.ok) return [];
  return listed.stdout.split("\n").filter((line) => line.trim() !== "");
};

export const diffAgainstHead = async (cwd: string): Promise<string> => {
  const result = await git(cwd, ["diff", "HEAD"]);
  return result.ok ? result.stdout : "";
};

export const applyPatch = (
  cwd: string,
  patchFile: string,
): Promise<GitResult> => git(cwd, ["apply", "--whitespace=nowarn", patchFile]);

export const addWorktree = (
  cwd: string,
  worktreePath: string,
  commit = "HEAD",
): Promise<GitResult> =>
  git(cwd, ["worktree", "add", "--detach", worktreePath, commit]);

export const removeWorktree = (
  cwd: string,
  worktreePath: string,
): Promise<GitResult> =>
  git(cwd, ["worktree", "remove", "--force", worktreePath]);

export const pruneWorktrees = (cwd: string): Promise<GitResult> =>
  git(cwd, ["worktree", "prune"]);

export const resetTrackedFiles = (cwd: string): Promise<GitResult> =>
  git(cwd, ["checkout", "--", "."]);

const parseCommit = (line: string): Commit | null => {
  const [hash, author, date, subject] = line.split(FIELD_SEPARATOR);
  if (hash === undefined || author === undefined || date === undefined) {
    return null;
  }
  return { hash, author, date, subject: subject ?? "" };
};

export const commitsIntroducing = async ({
  cwd,
  needle,
  paths = [],
  limit = 20,
}: {
  cwd: string;
  needle: string;
  paths?: readonly string[];
  limit?: number;
}): Promise<Commit[]> => {
  const args = ["log", `-S${needle}`, LOG_FORMAT, `--max-count=${limit}`];
  if (paths.length > 0) args.push("--", ...paths);
  const result = await git(cwd, args);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(parseCommit)
    .filter((commit): commit is Commit => commit !== null);
};

export const mergeBaseWith = async (
  cwd: string,
  ref: string,
): Promise<string | null> => (await output(cwd, ["merge-base", "HEAD", ref])) || null;

export const diffAgainstCommit = async (
  cwd: string,
  commit: string,
): Promise<string> => {
  const result = await git(cwd, [
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    commit,
  ]);
  return result.ok ? result.stdout : "";
};

export const listedFiles = async (
  cwd: string,
  patterns: readonly string[],
): Promise<string[]> => {
  const result = await git(cwd, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ...patterns,
  ]);
  if (!result.ok) return [];
  return result.stdout.split("\n").filter((line) => line.trim() !== "");
};
