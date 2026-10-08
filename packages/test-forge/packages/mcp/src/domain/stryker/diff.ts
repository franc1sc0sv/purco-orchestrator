import type { ChangedLines } from "test-forge-contracts/stryker";

const FILE_HEADER = /^\+\+\+ b[/](.+)$/;

const HUNK_HEADER = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/;

const MUTATED_EXTENSION = /\.tsx?$/;

const TEST_FILE = /\.(?:test|spec)\.tsx?$/;

const NON_PRODUCTION_PATTERNS: readonly RegExp[] = [
  /\.d\.ts$/,
  TEST_FILE,
  /(?:^|[/])tests?[/]/,
  /(?:^|[/])__tests__[/]/,
  /(?:^|[/])__mocks__[/]/,
  /\.stories\.tsx?$/,
  /(?:^|[/])\.test-forge[/]/,
];

const WIRING_PATTERNS: readonly RegExp[] = [
  /\.module\.ts$/,
  /\.router\.ts$/,
  /\.output\.schema\.ts$/,
  /(?:^|[/])dtos[/]outputs[/]/,
];

export const isProductionSource = (path: string): boolean =>
  MUTATED_EXTENSION.test(path) &&
  !NON_PRODUCTION_PATTERNS.some((pattern) => pattern.test(path));

export const isMutationTarget = (path: string): boolean =>
  isProductionSource(path) &&
  !WIRING_PATTERNS.some((pattern) => pattern.test(path));

export const isTestFile = (path: string): boolean => TEST_FILE.test(path);

export const parseChangedLines = (diff: string): ChangedLines => {
  const changed: ChangedLines = {};
  let current: string | null = null;
  for (const line of diff.split("\n")) {
    const header = FILE_HEADER.exec(line);
    if (header !== null) {
      current = header[1] ?? null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      current = null;
      continue;
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk === null || current === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count === 0) continue;
    const ranges = changed[current] ?? [];
    ranges.push([start, start + count - 1]);
    changed[current] = ranges;
  }
  return changed;
};

export const wholeFileRange = (text: string): [number, number] => [
  1,
  Math.max(1, text.split("\n").length),
];
