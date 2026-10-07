import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isTestPath } from "./test-paths.ts";

export type WriteSnapshot = {
  head: string;
  gitDir: string;
  states: Map<string, string>;
  contents: Map<string, Buffer>;
};

export const AUDIT_SKIPPED_DIRECTORIES = [
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "test-results",
  "playwright-report",
  ".purco-recording",
] as const;

const SKIPPED = new Set<string>(AUDIT_SKIPPED_DIRECTORIES);
const GIT_PREFIX = ".git/";
const GIT_WATCHED = ["hooks", "info"] as const;
const CLEAN = "clean";
const MISSING = "missing";
const NOT_A_FILE = "not-a-file";
const HEAD_CHANGED = "HEAD";
const LIST_CAP = 5;
const BUSY = /index\.lock|unable to lock|resource temporarily unavailable|busy/i;
const BUSY_RETRY_MS = 500;
const MAX_REASON = 120;

class GitFailure extends Error {
  readonly busy: boolean;
  constructor(command: string, busy: boolean) {
    super(`git ${command} failed`);
    this.busy = busy;
  }
}

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const runGit = (root: string, args: string[]): string =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

const git = (root: string, args: string[]): string => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return runGit(root, args);
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? "");
      const busy = BUSY.test(stderr);
      if (busy && attempt === 0) {
        sleep(BUSY_RETRY_MS);
        continue;
      }
      throw new GitFailure(args[0] ?? "command", busy);
    }
  }
};

export const writeAuditReason = (error: unknown): string => {
  if (error instanceof GitFailure) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return `file error ${code}`;
  return (error instanceof Error ? error.name : "error").slice(0, MAX_REASON);
};

const headOf = (root: string): string => {
  try {
    return git(root, ["rev-parse", "-q", "--verify", "HEAD"]).trim();
  } catch (error) {
    if (error instanceof GitFailure && error.busy) throw error;
    return "none";
  }
};

const isSkipped = (file: string): boolean => file.split("/").some((part) => SKIPPED.has(part));

const statusPaths = (root: string): string[] => {
  const tokens = git(root, ["status", "--porcelain", "-z", "--untracked-files=all"])
    .split("\0")
    .filter((token) => token.length > 0);
  const found: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    found.push(token.slice(3));
    if (/[RC]/.test(token.slice(0, 2))) {
      index += 1;
      found.push(tokens[index] ?? "");
    }
  }
  return found.filter((file) => file.length > 0 && !isTestPath(file));
};

const ignoredPaths = (root: string): string[] =>
  git(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"])
    .split("\0")
    .filter((file) => file.length > 0 && !isSkipped(file) && !isTestPath(file));

const commonGitDir = (root: string): string =>
  path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]).trim());

const walkFiles = (directory: string, prefix: string): string[] => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw error;
  }
  return entries.flatMap((entry) =>
    entry.isDirectory()
      ? walkFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
};

const gitInternalPaths = (gitDir: string): string[] => [
  `${GIT_PREFIX}config`,
  ...GIT_WATCHED.flatMap((name) => walkFiles(path.join(gitDir, name), `${GIT_PREFIX}${name}/`)),
];

const locate = (root: string, gitDir: string, key: string): string =>
  key.startsWith(GIT_PREFIX) ? path.join(gitDir, key.slice(GIT_PREFIX.length)) : path.join(root, key);

const hashOf = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const readState = (absolute: string): { state: string; bytes?: Buffer } => {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return { state: MISSING };
    throw error;
  }
  if (stat.isSymbolicLink()) {
    const target = Buffer.from(fs.readlinkSync(absolute));
    return { state: `link:${hashOf(target)}`, bytes: target };
  }
  if (!stat.isFile()) return { state: NOT_A_FILE };
  const bytes = fs.readFileSync(absolute);
  return { state: `${hashOf(bytes)}:${(stat.mode & 0o777).toString(8)}`, bytes };
};

export const takeWriteSnapshot = (root: string): WriteSnapshot => {
  const gitDir = commonGitDir(root);
  const states = new Map<string, string>();
  const contents = new Map<string, Buffer>();
  const keys = new Set([...statusPaths(root), ...ignoredPaths(root), ...gitInternalPaths(gitDir)]);
  for (const key of keys) {
    const { state, bytes } = readState(locate(root, gitDir, key));
    states.set(key, state);
    if (bytes) contents.set(key, bytes);
  }
  return { head: headOf(root), gitDir, states, contents };
};

export const diffWriteSnapshots = (before: WriteSnapshot, after: WriteSnapshot): string[] => {
  const changed = [...new Set([...before.states.keys(), ...after.states.keys()])]
    .filter((file) => (before.states.get(file) ?? CLEAN) !== (after.states.get(file) ?? CLEAN))
    .sort();
  return before.head === after.head ? changed : [HEAD_CHANGED, ...changed];
};

const inHead = (root: string, file: string): boolean => {
  try {
    git(root, ["cat-file", "-e", `HEAD:${file}`]);
    return true;
  } catch (error) {
    if (error instanceof GitFailure && error.busy) throw error;
    return false;
  }
};

const restoreOne = (root: string, before: WriteSnapshot, file: string): void => {
  const absolute = locate(root, before.gitDir, file);
  const prior = before.states.get(file);
  const internal = file.startsWith(GIT_PREFIX);
  if (prior === undefined) {
    if (!internal && inHead(root, file)) {
      git(root, ["checkout", "HEAD", "--", file]);
      return;
    }
    if (!internal) git(root, ["rm", "-f", "-q", "--cached", "--ignore-unmatch", "--", file]);
    fs.rmSync(absolute, { force: true });
    return;
  }
  if (prior === NOT_A_FILE) return;
  const bytes = before.contents.get(file);
  fs.rmSync(absolute, { force: true });
  if (bytes === undefined) return;
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  if (prior.startsWith("link:")) {
    fs.symlinkSync(bytes.toString(), absolute);
    return;
  }
  fs.writeFileSync(absolute, bytes);
  fs.chmodSync(absolute, Number.parseInt(prior.slice(prior.lastIndexOf(":") + 1), 8));
};

export const restoreWriteSnapshot = (root: string, before: WriteSnapshot, files: string[]): string[] => {
  const failed: string[] = [];
  if (files.includes(HEAD_CHANGED) && before.head !== "none") {
    try {
      git(root, ["reset", "--soft", before.head]);
    } catch {
      failed.push(HEAD_CHANGED);
    }
  }
  for (const file of files.filter((candidate) => candidate !== HEAD_CHANGED && !isTestPath(candidate))) {
    try {
      restoreOne(root, before, file);
    } catch {
      failed.push(file);
    }
  }
  return failed;
};

export const rebaseAfterRestore = (
  baseline: WriteSnapshot,
  restoredTo: WriteSnapshot,
  files: string[],
): void => {
  for (const file of files) {
    if (file === HEAD_CHANGED) {
      baseline.head = restoredTo.head;
      continue;
    }
    const state = restoredTo.states.get(file);
    const bytes = restoredTo.contents.get(file);
    if (state === undefined) baseline.states.delete(file);
    else baseline.states.set(file, state);
    if (bytes === undefined) baseline.contents.delete(file);
    else baseline.contents.set(file, bytes);
  }
};

export const describeWriteViolation = (files: string[]): string => {
  const shown = files.slice(0, LIST_CAP).join(", ");
  return files.length > LIST_CAP ? `${shown} and ${files.length - LIST_CAP} more` : shown;
};
