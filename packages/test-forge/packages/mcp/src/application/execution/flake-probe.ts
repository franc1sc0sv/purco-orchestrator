import {
  boundedRepeats,
  boundedSeed,
  detectFamily,
  seededShuffle,
  shuffleArgs,
  testKey,
} from "../../domain/execution/command.ts";
import { execSuite } from "./run-suite.ts";
import type {
  Divergence,
  FlakeReport,
  ProbeRun,
  RunnerFamily,
  SuiteRun,
} from "test-forge-contracts/execution";

export type FlakeProbeOptions = {
  cwd: string;
  command: string;
  files?: readonly string[];
  repeats?: number;
  seed?: number;
  family?: RunnerFamily;
  timeoutMs?: number;
};

type Attempt = ProbeRun & { run: SuiteRun };

const statusMap = (run: SuiteRun): Map<string, string> => {
  const map = new Map<string, string>();
  for (const test of run.tests) {
    map.set(testKey(test.file, test.testName), test.status);
  }
  return map;
};

const divergencesOf = (attempts: readonly Attempt[]): Divergence[] => {
  const maps = attempts.map((attempt) => statusMap(attempt.run));
  const keys = new Set(maps.flatMap((map) => [...map.keys()]));
  const divergences: Divergence[] = [];
  for (const key of keys) {
    const statuses = maps.map((map) => map.get(key) ?? "absent");
    if (new Set(statuses).size <= 1) continue;
    divergences.push({
      testKey: key,
      statuses,
      kind: statuses.includes("absent") ? "presence" : "status",
    });
  }
  return divergences;
};

export const flakeProbe = async ({
  cwd,
  command,
  files = [],
  repeats = 3,
  seed = 1,
  family: forcedFamily,
  timeoutMs,
}: FlakeProbeOptions): Promise<FlakeReport> => {
  const total = boundedRepeats(repeats);
  const usedSeed = boundedSeed(seed);
  const family = forcedFamily ?? detectFamily(command);
  const nativeShuffle = shuffleArgs(family, usedSeed);
  const attempts: Attempt[] = [];

  for (let index = 0; index < total; index += 1) {
    const shuffled = index === total - 1;
    const order = shuffled ? seededShuffle(files, usedSeed) : [...files];
    const run = await execSuite({
      cwd,
      command,
      files: order,
      family,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      extraArgs: shuffled ? nativeShuffle : [],
    });
    attempts.push({
      index,
      shuffled,
      fileOrder: order,
      nativeShuffleArgs: shuffled ? nativeShuffle : [],
      passed: run.passed,
      failed: run.failed,
      skipped: run.skipped,
      reportParsed: run.reportParsed,
      reportError: run.reportError,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      failures: run.failures,
      testCount: run.tests.length,
      run,
    });
  }

  const unparsed = attempts.filter((attempt) => !attempt.reportParsed);
  const divergences = divergencesOf(attempts);
  const countsDiverge =
    unparsed.length === 0 &&
    new Set(
      attempts.map(
        (attempt) => `${attempt.passed}/${attempt.failed}/${attempt.skipped}`
      )
    ).size > 1;

  return {
    stable: unparsed.length === 0 && divergences.length === 0 && !countsDiverge,
    seed: usedSeed,
    repeats: total,
    family,
    nativeShuffleSupported: nativeShuffle.length > 0,
    unparsedRuns: unparsed.map((attempt) => ({
      index: attempt.index,
      reportError: attempt.reportError,
    })),
    countsDiverge,
    divergences,
    runs: attempts.map(({ run, ...rest }) => rest),
  };
};
