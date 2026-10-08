import { SCAFFOLD_DIRECTORY } from "./campaign-files.ts";
import { listedFiles } from "./git.ts";
import { runProcess } from "./process.ts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { MutationEdit, MutatedRun } from "./solo-backup.ts";

const LANES_DIRECTORY = `${SCAFFOLD_DIRECTORY}/stryker-run/lanes`;

const NOT_COPIED: ReadonlySet<string> = new Set([
  ".git",
  ".next",
  ".test-forge",
  "coverage",
  "node_modules",
]);

export type SoloLane = {
  index: number;
  root: string;
};

export type SoloLanePool = {
  ensure: (count: number) => Promise<SoloLane[]>;
  dispose: () => void;
};

const lanesDirectoryOf = (root: string): string =>
  join(root, ...LANES_DIRECTORY.split("/"));

const copyEntry = async (from: string, to: string): Promise<void> => {
  const cloned = await runProcess({
    command: "cp",
    args: ["-c", "-R", from, to],
    cwd: dirname(from),
  });
  if (cloned.code === 0) return;
  rmSync(to, { recursive: true, force: true });
  const copied = await runProcess({
    command: "cp",
    args: ["-R", from, to],
    cwd: dirname(from),
  });
  if (copied.code !== 0) {
    throw new Error(`could not copy ${from} into a lane: ${copied.stderr.trim()}`);
  }
};

const topLevelEntriesOf = async (root: string): Promise<string[]> => {
  const listed = await listedFiles(root, []);
  const entries = new Set(listed.map((file) => file.split("/")[0] ?? file));
  return [...entries].filter(
    (entry) => !NOT_COPIED.has(entry) && existsSync(join(root, entry)),
  );
};

const createLane = async (
  root: string,
  entries: readonly string[],
  index: number,
): Promise<SoloLane> => {
  const laneRoot = join(lanesDirectoryOf(root), `lane-${index}`);
  rmSync(laneRoot, { recursive: true, force: true });
  mkdirSync(laneRoot, { recursive: true });
  const copies = await Promise.allSettled(
    entries.map((entry) => copyEntry(join(root, entry), join(laneRoot, entry))),
  );
  for (const copy of copies) {
    if (copy.status === "rejected") throw copy.reason;
  }
  symlinkSync(join(root, "node_modules"), join(laneRoot, "node_modules"));
  return { index, root: laneRoot };
};

export const removeSoloLanes = (root: string): void => {
  rmSync(lanesDirectoryOf(root), {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
};

export const soloLanePoolOf = (root: string): SoloLanePool => {
  const lanes: SoloLane[] = [];
  return {
    ensure: async (count) => {
      if (lanes.length < count) {
        const entries = await topLevelEntriesOf(root);
        const missing = Array.from(
          { length: count - lanes.length },
          (_, offset) => lanes.length + offset,
        );
        lanes.push(
          ...(await Promise.all(missing.map((index) => createLane(root, entries, index)))),
        );
      }
      return lanes.slice(0, count);
    },
    dispose: () => {
      lanes.length = 0;
      removeSoloLanes(root);
    },
  };
};

export const slotsOf = (first: number, count: number) => {
  const free = Array.from({ length: count }, (_, offset) => first + offset);
  const waiting: ((slot: number) => void)[] = [];
  return async <TResult>(work: (slot: number) => Promise<TResult>): Promise<TResult> => {
    const slot = free.pop() ?? (await new Promise<number>((claim) => waiting.push(claim)));
    try {
      return await work(slot);
    } finally {
      const next = waiting.shift();
      if (next === undefined) free.push(slot);
      else next(slot);
    }
  };
};

export const runMutatedInLane = async <TResult>(
  laneRoot: string,
  file: string,
  edit: (source: string) => MutationEdit,
  work: () => Promise<TResult>,
): Promise<MutatedRun<TResult>> => {
  const target = join(laneRoot, file);
  const original = readFileSync(target);
  const mutated = edit(original.toString("utf8"));
  if (!mutated.ok) return { ok: false, reason: mutated.reason };
  try {
    writeFileSync(target, mutated.text);
    return { ok: true, value: await work() };
  } finally {
    writeFileSync(target, original);
  }
};
