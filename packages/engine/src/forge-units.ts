import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { WorkItem } from "test-forge-contracts/gates";
import { isTestPath } from "./test-paths.ts";

export type ForgeScope = "backend" | "frontend";

export type UnitRow = { matrixKey: string; rowKey: string };

export type Unit = {
  file: string;
  sources: string[];
  rows: UnitRow[];
  focusLines: number[];
};

export type LineRange = readonly [number, number];

const RUN_FILE = "forge-run.json";

const SOURCE = /\.(ts|tsx)$/;

const git = (worktree: string, args: string[]): string[] => {
  try {
    return execFileSync("git", args, {
      cwd: worktree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
};

const untracked = (worktree: string): string[] =>
  git(worktree, ["ls-files", "--others", "--exclude-standard"]).map((line) => line.trim());

export const worktreeFiles = (worktree: string): string[] => [
  ...new Set([...git(worktree, ["ls-files"]), ...untracked(worktree)].map((line) => line.trim())),
];

export const changedProductionFiles = (worktree: string, base: string): string[] =>
  [
    ...new Set([
      ...git(worktree, ["diff", "--name-only", `origin/${base}`]).map((line) => line.trim()),
      ...untracked(worktree),
    ]),
  ]
    .filter((file) => SOURCE.test(file) && !isTestPath(file))
    .sort();

export const changedRanges = (
  worktree: string,
  base: string,
  files: readonly string[],
): Record<string, LineRange[]> => {
  const fresh = new Set(untracked(worktree));
  const ranges: Record<string, LineRange[]> = {};
  for (const file of files) {
    if (fresh.has(file)) {
      ranges[file] = [[1, Number.MAX_SAFE_INTEGER]];
      continue;
    }
    ranges[file] = git(worktree, ["diff", "-U0", `origin/${base}`, "--", file])
      .map((line) => /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match): LineRange => {
        const start = Number(match[1]);
        const count = match[2] === undefined ? 1 : Number(match[2]);
        return [start, start + count - 1];
      })
      .filter(([start, end]) => end >= start);
  }
  return ranges;
};

export const scopeFor = (files: readonly string[]): ForgeScope =>
  files.length === 0 || files.some((file) => file.startsWith("src/server/"))
    ? "backend"
    : "frontend";

export const testSurface = (pack: string): string | undefined => {
  const file = path.join(pack, "02-plan.md");
  if (!fs.existsSync(file)) return undefined;
  const plan = fs.readFileSync(file, "utf8");
  const section =
    /^#{1,6}\s*Test surface\s*$([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im.exec(plan) ??
    /\*\*Test surface\*\*[:\s—-]*([\s\S]*?)(?=\n\s*[-*]\s*\*\*|\n#|(?![\s\S]))/.exec(plan);
  const surface = section?.[1]
    ?.split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
  return surface || undefined;
};

type RunFile = Partial<Record<ForgeScope, { runId: number; at: string }>>;

const readRunFile = (pack: string): RunFile => {
  const file = path.join(pack, RUN_FILE);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as RunFile & {
      runId?: unknown;
      scope?: unknown;
      at?: unknown;
    };
    if (typeof parsed.runId === "number" && (parsed.scope === "backend" || parsed.scope === "frontend")) {
      return { [parsed.scope]: { runId: parsed.runId, at: String(parsed.at ?? "") } };
    }
    return parsed;
  } catch {
    return {};
  }
};

export const storedRun = (pack: string, scope: ForgeScope): number | undefined =>
  readRunFile(pack)[scope]?.runId;

export const storeRun = (pack: string, scope: ForgeScope, runId: number): void => {
  const runs = { ...readRunFile(pack), [scope]: { runId, at: new Date().toISOString() } };
  fs.writeFileSync(path.join(pack, RUN_FILE), JSON.stringify(runs, null, 2));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export const readUnits = (file: string): Unit[] | string => {
  if (!fs.existsSync(file)) return `${file} does not exist`;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return `${file} is not valid JSON: ${String(error)}`;
  }
  const list = isRecord(raw) ? raw.units : undefined;
  if (!Array.isArray(list) || list.length === 0) return `${file} lists no unit`;
  const units: Unit[] = [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.file !== "string") return `${file} has a unit with no file`;
    if (!isTestPath(entry.file)) return `${entry.file} is not a test file path`;
    const rows = Array.isArray(entry.rows)
      ? entry.rows
          .filter(isRecord)
          .filter((row) => typeof row.matrixKey === "string" && typeof row.rowKey === "string")
          .map((row) => ({ matrixKey: String(row.matrixKey), rowKey: String(row.rowKey) }))
      : [];
    const focusLines = Array.isArray(entry.focusLines)
      ? entry.focusLines.filter((line): line is number => Number.isInteger(line))
      : [];
    units.push({ file: entry.file, sources: strings(entry.sources), rows, focusLines });
  }
  const files = units.map((unit) => unit.file);
  if (new Set(files).size !== files.length) return `${file} names one test file twice`;
  return units;
};

export const sameFile = (left: string, right: string): boolean =>
  left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);

export const unitForFile = (units: readonly Unit[], file: string): Unit | undefined =>
  units.find((unit) => sameFile(unit.file, file));

export const unitsForSource = (units: readonly Unit[], source: string): Unit[] =>
  units.filter((unit) => unit.sources.some((entry) => sameFile(entry, source)));

const unitForCell = (units: readonly Unit[], ref: string): Unit | undefined => {
  const [matrixKey, rowKey] = ref.split("|");
  return units.find((unit) =>
    unit.rows.some((row) => row.matrixKey === matrixKey && row.rowKey === rowKey),
  );
};

const unitForFocus = (units: readonly Unit[], ref: string): Unit | undefined =>
  units.find((unit) => unit.focusLines.includes(Number(ref)));

const testFileOf = (ref: string): string => ref.split("::")[0] ?? ref;

export type Routed = {
  byFile: Map<string, string[]>;
  inspect: Set<string>;
  verify: WorkItem[];
  unrouted: WorkItem[];
};

const NO_VERDICT = /carries no verdict/;

export const routeWork = (
  units: readonly Unit[],
  workList: readonly WorkItem[],
  ruledTests: ReadonlySet<string>,
): Routed => {
  const routed: Routed = { byFile: new Map(), inspect: new Set(), verify: [], unrouted: [] };
  const give = (unit: Unit | undefined, item: WorkItem, line: string): void => {
    if (unit === undefined) {
      routed.unrouted.push(item);
      return;
    }
    routed.byFile.set(unit.file, [...(routed.byFile.get(unit.file) ?? []), line]);
  };
  for (const item of workList) {
    const line = `${item.predicate} ${item.predicateName} · ${item.ref} · ${item.reason} · at ${item.location}`;
    switch (item.predicate) {
      case "D1":
        give(unitForFile(units, item.ref), item, line);
        break;
      case "D2": {
        const unit = unitForFile(units, testFileOf(item.ref));
        if (unit && NO_VERDICT.test(item.reason)) routed.inspect.add(unit.file);
        else give(unit, item, line);
        break;
      }
      case "D3":
        give(unitForFile(units, item.ref), item, line);
        break;
      case "D4":
        if (ruledTests.has(item.ref)) give(unitForFile(units, testFileOf(item.ref)), item, line);
        else if (unitForFile(units, testFileOf(item.ref))) routed.verify.push(item);
        else routed.unrouted.push(item);
        break;
      case "D6":
        give(unitForFile(units, testFileOf(item.ref)), item, line);
        break;
      case "D7":
        give(unitForCell(units, item.ref), item, line);
        break;
      case "D9":
        give(unitForFocus(units, item.ref), item, line);
        break;
      default:
        routed.unrouted.push(item);
    }
  }
  return routed;
};

export const fileSlug = (file: string): string =>
  file.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
