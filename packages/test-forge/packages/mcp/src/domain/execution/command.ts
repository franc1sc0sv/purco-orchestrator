import type {
  RunnerFamily,
  SeparatorMode,
} from "test-forge-contracts/execution";

export const MAX_MESSAGE_CHARS = 1_200;

export const MAX_DIAGNOSTIC_CHARS = 1_200;

export const MAX_DIAGNOSTIC_TAIL_BYTES = 6_000;

export const MAX_PROBLEMS = 300;

const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/g;

const PACKAGE_RUNNERS: ReadonlySet<string> = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
]);

const DIRECT_BINARIES: ReadonlySet<string> = new Set([
  "vitest",
  "jest",
  "playwright",
  "mocha",
  "node",
  "tsc",
  "tsgo",
  "eslint",
  "biome",
  "oxlint",
  "exec",
  "dlx",
  "run-p",
  "run-s",
]);

export const stripAnsi = (text: string): string =>
  text.replace(ANSI_PATTERN, "");

export const clamp = (text: string, limit: number): string => {
  const clean = stripAnsi(text).trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
};

export const tail = (text: string, limit: number): string =>
  clamp(text.slice(-MAX_DIAGNOSTIC_TAIL_BYTES), limit);

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

const lastSegment = (value: string): string =>
  value.split(/[\\/]/).at(-1) ?? "";

export const needsSeparator = (
  command: string,
  mode: SeparatorMode
): boolean => {
  if (mode === "always") return true;
  if (mode === "never") return false;
  if (/\s--(\s|$)/.test(command)) return false;
  const tokens = command.trim().split(/\s+/);
  if (!PACKAGE_RUNNERS.has(lastSegment(tokens[0] ?? ""))) return false;
  return !DIRECT_BINARIES.has(lastSegment(tokens[1] ?? ""));
};

export const composeCommand = (
  command: string,
  extraArgs: readonly string[],
  separatorMode: SeparatorMode = "auto"
): string => {
  const args = extraArgs.filter((argument) => argument !== "");
  if (args.length === 0) return command;
  const separator = needsSeparator(command, separatorMode) ? " --" : "";
  return `${command}${separator} ${args.map(shellQuote).join(" ")}`;
};

export const detectFamily = (command: string): RunnerFamily => {
  const text = command.toLowerCase();
  if (/\bvitest\b/.test(text)) return "vitest";
  if (/\bjest\b/.test(text)) return "jest";
  if (/\bplaywright\b/.test(text) || /\bpw-test\b/.test(text)) {
    return "playwright";
  }
  if (/\bmocha\b/.test(text)) return "mocha";
  if (/node[^|;&]*--test\b/.test(text) || /\bnode:test\b/.test(text)) {
    return "node-test";
  }
  if (
    /\btest:frontend\b|\btest:backend\b|\btest:unit\b|\btest:integration\b/.test(
      text
    )
  ) {
    return "vitest";
  }
  return "unknown";
};

export type ReporterPlumbing = {
  args: string[];
  env: Record<string, string>;
};

export const reporterPlumbing = (
  family: RunnerFamily,
  reportPath: string
): ReporterPlumbing => {
  if (family === "vitest") {
    return {
      args: ["--reporter=json", `--outputFile=${reportPath}`],
      env: {},
    };
  }
  if (family === "jest") {
    return { args: ["--json", `--outputFile=${reportPath}`], env: {} };
  }
  if (family === "playwright") {
    return {
      args: ["--reporter=json"],
      env: { PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
    };
  }
  if (family === "mocha") {
    return {
      args: ["--reporter", "json", "--reporter-option", `output=${reportPath}`],
      env: {},
    };
  }
  if (family === "node-test") {
    return {
      args: [
        "--test-reporter=junit",
        `--test-reporter-destination=${reportPath}`,
      ],
      env: {},
    };
  }
  return { args: [], env: {} };
};

export const shuffleArgs = (family: RunnerFamily, seed: number): string[] => {
  if (family === "vitest") {
    return ["--sequence.shuffle=true", `--sequence.seed=${seed}`];
  }
  if (family === "jest") return ["--randomize", `--seed=${seed}`];
  return [];
};

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const seededShuffle = <TItem>(
  items: readonly TItem[],
  seed: number
): TItem[] => {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = copy[index];
    const other = copy[swap];
    if (held === undefined || other === undefined) continue;
    copy[index] = other;
    copy[swap] = held;
  }
  return copy;
};

export const testKey = (file: string, testName: string): string =>
  `${file || "<unknown-file>"} :: ${testName}`;

export const boundedRepeats = (repeats: number): number =>
  Math.max(2, Math.min(Math.trunc(Number(repeats) || 3), 10));

export const boundedSeed = (seed: number): number =>
  Math.trunc(Number(seed) || 1);
