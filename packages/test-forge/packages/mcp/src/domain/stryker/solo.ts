import type { Kill, MutantOutcome } from "test-forge-contracts/mutation";
import type { MutantSite } from "test-forge-contracts/stryker";
import { offsetOf } from "./report.ts";

export const SOLO_LIMIT_FACTOR = 3;

export const SOLO_LIMIT_PADDING_MS = 5_000;

export const SOLO_LIMIT_FLOOR_MS = 10_000;

export const SOLO_MAX_LANES = 6;

export const SOLO_RESERVED_CORES = 3;

export const MAX_NAME_PATTERN_LENGTH = 200_000;

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

const SYNTAX_FAILURE = /SyntaxError|Transform failed|Unexpected token|Parse error/;

export type SoloObservation = {
  timedOut: boolean;
  exitCode: number | null;
  failures: readonly Kill[];
  suiteErrors: readonly Kill[];
  suiteMessage: string;
};

export type SoloVerdict = {
  outcome: MutantOutcome;
  strykerStatus: string;
  killedBy: Kill[];
};

export const soloLimitMs = (baselineMs: number): number =>
  Math.max(
    SOLO_LIMIT_FLOOR_MS,
    Math.ceil(SOLO_LIMIT_FACTOR * baselineMs) + SOLO_LIMIT_PADDING_MS,
  );

export const soloLaneCount = (cpuCount: number, jobCount: number): number =>
  Math.max(1, Math.min(SOLO_MAX_LANES, cpuCount - SOLO_RESERVED_CORES, jobCount));

const PLACEHOLDER = /%[sdifjoO#]|\\\$[A-Za-z_][\w.]*/g;

const namePatternOf = (name: string): string =>
  name.replace(REGEXP_SPECIALS, "\\$&").replace(PLACEHOLDER, ".*");

export const testNamePatternOf = (names: readonly string[]): string | null => {
  const distinct = [...new Set(names)].sort();
  if (distinct.length === 0) return null;
  const pattern = `(?:^| )(?:${distinct.map(namePatternOf).join("|")})$`;
  return pattern.length > MAX_NAME_PATTERN_LENGTH ? null : pattern;
};

export const verdictOf = (observation: SoloObservation): SoloVerdict => {
  if (observation.timedOut) {
    return { outcome: "killed_by_timeout", strykerStatus: "TimeoutSolid", killedBy: [] };
  }
  const [firstFailure] = observation.failures;
  if (firstFailure !== undefined) {
    return {
      outcome: "killed",
      strykerStatus: "KilledSolo",
      killedBy: [...observation.failures],
    };
  }
  if (observation.exitCode === 0) {
    return { outcome: "survived", strykerStatus: "SurvivedSolo", killedBy: [] };
  }
  if (SYNTAX_FAILURE.test(observation.suiteMessage)) {
    return { outcome: "unviable", strykerStatus: "CompileErrorSolo", killedBy: [] };
  }
  const [firstSuite] = observation.suiteErrors;
  if (firstSuite !== undefined) {
    return {
      outcome: "killed",
      strykerStatus: "KilledSuiteSolo",
      killedBy: [...observation.suiteErrors],
    };
  }
  return { outcome: "error", strykerStatus: "ErrorSolo", killedBy: [] };
};

export type SpanEdit =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export const applyReplacement = (
  source: string,
  site: MutantSite,
  expectedOriginal: string,
): SpanEdit => {
  const start = offsetOf(source, site.start);
  const end = offsetOf(source, site.end);
  if (start >= end || end > source.length) {
    return { ok: false, reason: "the recorded span is outside the file" };
  }
  const found = source.slice(start, end);
  if (expectedOriginal !== "" && found !== expectedOriginal) {
    return {
      ok: false,
      reason: "the text at the recorded span differs from the ledger, so the file changed after the run",
    };
  }
  return { ok: true, text: `${source.slice(0, start)}${site.replacement}${source.slice(end)}` };
};
