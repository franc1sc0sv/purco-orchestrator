import { SCAFFOLD_DIRECTORY } from "./campaign-files.ts";
import { processAlive } from "./detached.ts";
import { ensureScaffoldIgnored } from "./stryker-files.ts";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const BACKUP_DIRECTORY = `${SCAFFOLD_DIRECTORY}/solo-backup`;

type JournalEntry = {
  file: string;
  backupFile: string;
  sha256: string;
  pid: number;
};

export type RecoveryResult = {
  restored: string[];
  blockedByPid: number | null;
};

export type MutationEdit =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export type MutatedRun<TResult> =
  | { ok: true; value: TResult }
  | { ok: false; reason: string };

const liveEntries = new Map<JournalEntry, string>();

const sha256Of = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const journalPathOf = (root: string): string =>
  join(root, ...BACKUP_DIRECTORY.split("/"), "journal.json");

const backupPathOf = (root: string, backupFile: string): string =>
  join(root, ...BACKUP_DIRECTORY.split("/"), backupFile);

const isEntry = (value: unknown): value is JournalEntry =>
  typeof value === "object" &&
  value !== null &&
  "file" in value &&
  typeof value.file === "string" &&
  "backupFile" in value &&
  typeof value.backupFile === "string" &&
  "sha256" in value &&
  typeof value.sha256 === "string" &&
  "pid" in value &&
  typeof value.pid === "number";

const readJournal = (root: string): JournalEntry[] => {
  const path = journalPathOf(root);
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
};

const writeJournal = (root: string, entries: readonly JournalEntry[]): void => {
  const path = journalPathOf(root);
  if (entries.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(join(root, ...BACKUP_DIRECTORY.split("/")), { recursive: true });
  writeFileSync(path, JSON.stringify(entries, null, 2));
};

const restoreEntry = (root: string, entry: JournalEntry): void => {
  const target = join(root, entry.file);
  const original = readFileSync(backupPathOf(root, entry.backupFile));
  if (sha256Of(original) !== entry.sha256) {
    throw new Error(`the backup of ${entry.file} does not match its recorded hash`);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    writeFileSync(target, original);
    if (sha256Of(readFileSync(target)) === entry.sha256) return;
  }
  throw new Error(`${entry.file} could not be restored to its original bytes`);
};

const release = (root: string, entry: JournalEntry): void => {
  restoreEntry(root, entry);
  rmSync(backupPathOf(root, entry.backupFile), { force: true });
  liveEntries.delete(entry);
  writeJournal(
    root,
    readJournal(root).filter(
      (candidate) =>
        candidate.file !== entry.file || candidate.pid !== entry.pid,
    ),
  );
};

export const recoverBackups = (root: string): RecoveryResult => {
  const restored: string[] = [];
  for (const entry of readJournal(root)) {
    if (entry.pid !== process.pid && processAlive(entry.pid)) {
      return { restored, blockedByPid: entry.pid };
    }
    if (existsSync(backupPathOf(root, entry.backupFile))) {
      release(root, entry);
      restored.push(entry.file);
    }
  }
  writeJournal(root, []);
  return { restored, blockedByPid: null };
};

export const runMutated = async <TResult>(
  root: string,
  file: string,
  edit: (source: string) => MutationEdit,
  work: () => Promise<TResult>,
): Promise<MutatedRun<TResult>> => {
  ensureScaffoldIgnored(root);
  const target = join(root, file);
  const original = readFileSync(target);
  const mutated = edit(original.toString("utf8"));
  if (!mutated.ok) return { ok: false, reason: mutated.reason };
  const entry: JournalEntry = {
    file,
    backupFile: `${sha256Of(Buffer.from(file))}.bak`,
    sha256: sha256Of(original),
    pid: process.pid,
  };
  mkdirSync(join(root, ...BACKUP_DIRECTORY.split("/")), { recursive: true });
  writeFileSync(backupPathOf(root, entry.backupFile), original);
  writeJournal(root, [...readJournal(root), entry]);
  liveEntries.set(entry, root);
  try {
    writeFileSync(target, mutated.text);
    return { ok: true, value: await work() };
  } finally {
    release(root, entry);
  }
};

const restoreAllOnExit = (): void => {
  for (const [entry, root] of liveEntries) restoreEntry(root, entry);
};

process.once("exit", restoreAllOnExit);
