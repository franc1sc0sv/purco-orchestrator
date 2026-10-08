import path from "node:path";
import type { Store } from "./store.ts";
import type { StoredNote } from "./types.ts";

const TRAILING_STOP = new RegExp("[.]+$");

export const noteLabel = (id: number): string => `N-${id}`;

export const relativeToWorktree = (worktree: string, file: string): string =>
  path.isAbsolute(file) ? path.relative(worktree, file) : file;

const locationOf = (note: StoredNote): string => {
  if (!note.file) return "";
  return ` on ${note.file}${note.line === undefined ? "" : `:${note.line}`}`;
};

export const noteBlock = (note: StoredNote): string => {
  const label = noteLabel(note.id);
  return `Note from the user (${label})${locationOf(note)}: ${note.text.trimEnd().replace(TRAILING_STOP, "")}. When done, list ${label} in applied_notes in your handoff with a one-line reply.`;
};

export const takeNotes = (input: {
  store: Store;
  worktree: string;
  agent: string;
  toolInput: Record<string, unknown>;
}): string | undefined => {
  const { store, worktree, agent, toolInput } = input;
  const queued = store.notes("queued");
  if (queued.length === 0) return undefined;
  const touching = typeof toolInput.file_path === "string" ? relativeToWorktree(worktree, toolInput.file_path) : undefined;
  const needsWrites = queued.some((note) => note.targetAgent === undefined && note.file !== undefined);
  const written = needsWrites
    ? new Set(
        store
          .fileWrites()
          .filter((write) => write.agent === agent)
          .map((write) => relativeToWorktree(worktree, write.file)),
      )
    : new Set<string>();
  const due = queued.filter((note) => {
    if (note.targetAgent !== undefined) return note.targetAgent === agent;
    if (note.file === undefined) return true;
    return note.file === touching || written.has(note.file);
  });
  if (due.length === 0) return undefined;
  store.markNotesSeen(due.map((note) => note.id));
  return due.map(noteBlock).join("\n");
};
