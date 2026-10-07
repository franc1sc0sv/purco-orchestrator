import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isTestPath } from "./test-paths.ts";

export type WriteSnapshot = {
  head: string;
  states: Map<string, string>;
  contents: Map<string, Buffer>;
};

const CLEAN = "clean";
const MISSING = "missing";
const NOT_A_FILE = "not-a-file";
const HEAD_CHANGED = "HEAD";
const LIST_CAP = 5;

const git = (root: string, args: string[]): string =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

const headOf = (root: string): string => {
  try {
    return git(root, ["rev-parse", "-q", "--verify", "HEAD"]).trim();
  } catch {
    return "none";
  }
};

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

const readState = (root: string, file: string): { state: string; bytes?: Buffer } => {
  const absolute = path.join(root, file);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    return { state: MISSING };
  }
  if (stat.isSymbolicLink()) {
    const target = Buffer.from(fs.readlinkSync(absolute));
    return { state: `link:${createHash("sha256").update(target).digest("hex")}`, bytes: target };
  }
  if (!stat.isFile()) return { state: NOT_A_FILE };
  const bytes = fs.readFileSync(absolute);
  return { state: createHash("sha256").update(bytes).digest("hex"), bytes };
};

export const takeWriteSnapshot = (root: string): WriteSnapshot => {
  const states = new Map<string, string>();
  const contents = new Map<string, Buffer>();
  for (const file of new Set(statusPaths(root))) {
    const { state, bytes } = readState(root, file);
    states.set(file, state);
    if (bytes) contents.set(file, bytes);
  }
  return { head: headOf(root), states, contents };
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
  } catch {
    return false;
  }
};

const removeFile = (root: string, file: string): void => {
  fs.rmSync(path.join(root, file), { force: true });
};

export const restoreWriteSnapshot = (root: string, before: WriteSnapshot, files: string[]): void => {
  if (headOf(root) !== before.head && before.head !== "none") {
    git(root, ["reset", "--soft", before.head]);
  }
  for (const file of files.filter((candidate) => candidate !== HEAD_CHANGED && !isTestPath(candidate))) {
    const prior = before.states.get(file);
    if (prior === undefined) {
      if (inHead(root, file)) {
        git(root, ["checkout", "HEAD", "--", file]);
      } else {
        git(root, ["rm", "-f", "-q", "--cached", "--ignore-unmatch", "--", file]);
        removeFile(root, file);
      }
      continue;
    }
    if (prior === NOT_A_FILE) continue;
    const bytes = before.contents.get(file);
    removeFile(root, file);
    if (bytes === undefined) continue;
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (prior.startsWith("link:")) fs.symlinkSync(bytes.toString(), absolute);
    else fs.writeFileSync(absolute, bytes);
  }
};

export const describeWriteViolation = (files: string[]): string => {
  const shown = files.slice(0, LIST_CAP).join(", ");
  return files.length > LIST_CAP ? `${shown} and ${files.length - LIST_CAP} more` : shown;
};
