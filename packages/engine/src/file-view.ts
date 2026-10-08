import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { relativeToWorktree } from "./notes.ts";
import { layerOf, snapshotOf } from "./story-view.ts";
import type { Store } from "./store.ts";
import type { ChangedFile } from "./types.ts";

const BASE_REF = "origin/dev";
const MAX_DIFF_BYTES = 2 * 1024 * 1024;

export type FileEntry = {
  path: string;
  layer: string;
  added: number;
  removed: number;
  isNew: boolean;
  version: number;
  agent?: string;
  at?: string;
};

export type FilesView = { files: FileEntry[] };

export type FileDiff = { path: string; isNew: boolean; diff: string };

const changedFiles = (store: Store): { worktree?: string; files: ChangedFile[] } => {
  const row = store.storyRow();
  const live = row.worktree && fs.existsSync(row.worktree) ? snapshotOf(row.worktree) : undefined;
  const snapshot = live && live.files.length > 0 ? live : (row.changes ?? { files: [], tables: [] });
  return { worktree: row.worktree, files: snapshot.files };
};

export const filesViewOf = (store: Store): FilesView => {
  const { worktree, files } = changedFiles(store);
  const writes = worktree
    ? store.fileWrites().map((write) => ({ ...write, file: relativeToWorktree(worktree, write.file) }))
    : [];
  return {
    files: files.map((file): FileEntry => {
      const own = writes.filter((write) => write.file === file.path);
      const last = own.at(-1);
      return {
        path: file.path,
        layer: layerOf(file.path) ?? "Other",
        added: file.added,
        removed: file.deleted,
        isNew: file.isNew,
        version: own.length,
        ...(last ? { agent: last.agent, at: last.at } : {}),
      };
    }),
  };
};

const gitText = (worktree: string, args: string[]): string => {
  try {
    return execFileSync("git", args, {
      cwd: worktree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: MAX_DIFF_BYTES,
    });
  } catch {
    return "";
  }
};

const additionDiff = (file: string, content: string): string => {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
};

export const fileDiffOf = (store: Store, requested: string): FileDiff | undefined => {
  const { worktree, files } = changedFiles(store);
  if (!worktree || !fs.existsSync(worktree)) return undefined;
  const changed = files.find((file) => file.path === requested);
  if (!changed) return undefined;
  const absolute = path.resolve(worktree, changed.path);
  if (!absolute.startsWith(path.resolve(worktree) + path.sep)) return undefined;
  const diff = gitText(worktree, ["diff", BASE_REF, "--", changed.path]);
  if (diff.length > 0) return { path: changed.path, isNew: changed.isNew, diff };
  try {
    return { path: changed.path, isNew: true, diff: additionDiff(changed.path, fs.readFileSync(absolute, "utf8")) };
  } catch {
    return { path: changed.path, isNew: changed.isNew, diff: "" };
  }
};
