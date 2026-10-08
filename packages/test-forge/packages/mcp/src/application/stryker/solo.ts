import {
  applyReplacement,
  SOLO_LIMIT_FLOOR_MS,
  soloLaneCount,
  soloLimitMs,
  testNamePatternOf,
  verdictOf,
} from "../../domain/stryker/solo.ts";
import { projectKindOf } from "../../domain/stryker/scope.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import {
  recordSoloOutcome,
  strykerRowsOf,
} from "../../infrastructure/db/stryker-store.ts";
import type { StrykerRow } from "../../infrastructure/db/stryker-store.ts";
import { repoRoot } from "../../infrastructure/git.ts";
import { recoverBackups, runMutated } from "../../infrastructure/solo-backup.ts";
import { runMutatedInLane, slotsOf, soloLanePoolOf } from "../../infrastructure/solo-lanes.ts";
import type { SoloLane, SoloLanePool } from "../../infrastructure/solo-lanes.ts";
import { runVitestSolo } from "../../infrastructure/solo-vitest.ts";
import type { SoloVitestResult } from "../../infrastructure/solo-vitest.ts";
import {
  ensureScaffoldIgnored,
  harnessPathsOf,
  STRYKER_RUN_DIRECTORY,
  writeSoloScaffold,
} from "../../infrastructure/stryker-files.ts";
import {
  DEFAULT_DB_SETUP_FILE,
  DEFAULT_PROJECT_CONFIG_FILE,
  harnessStatus,
} from "./harness.ts";
import { cpus } from "node:os";
import { join } from "node:path";
import type { MutantOutcome } from "test-forge-contracts/mutation";
import { PROJECT_KINDS } from "test-forge-contracts/stryker";
import type {
  ProjectKind,
  SoloMutantResult,
  SoloRunSummary,
  StrykerCounts,
  TimeoutRecheckResult,
} from "test-forge-contracts/stryker";

export type SoloInput = {
  cwd: string;
  runId: number;
  bail?: boolean | undefined;
  record?: boolean | undefined;
  lanes?: SoloLanePool | undefined;
  projectConfigFile?: string | undefined;
  dbSetupFile?: string | undefined;
};

export type SoloJob = {
  row: StrykerRow;
  kind: ProjectKind;
  testFiles: string[];
};

export type SoloBatch =
  | { ok: true; results: SoloMutantResult[]; recoveredBackups: string[] }
  | { ok: false; reason: string };

const STORED_ORIGINAL_LIMIT = 500;

const BASELINE_CEILING_MS = 30 * 60 * 1000;

const BASELINE_SLOTS = 6;

export const jobOf = (row: StrykerRow): SoloJob => ({
  row,
  kind: projectKindOf(row.site.file),
  testFiles: [...new Set(row.coveredBy.map((test) => test.file))].sort(),
});

const cacheKeyOf = (job: SoloJob, testNamePattern: string | null): string =>
  `${job.kind}|${job.testFiles.join("|")}|${testNamePattern ?? ""}`;

const tally = (counts: StrykerCounts, outcome: MutantOutcome): void => {
  counts[outcome] = (counts[outcome] ?? 0) + 1;
};

export const summarizeSolo = (
  results: SoloMutantResult[],
  recoveredBackups: string[],
  startedAt: number,
): SoloRunSummary => {
  const counts: StrykerCounts = {};
  for (const result of results) tally(counts, result.outcome);
  return {
    checked: results.length,
    counts,
    results,
    recoveredBackups,
    durationMs: Date.now() - startedAt,
  };
};

const resultOf = (
  job: SoloJob,
  fields: Pick<
    SoloMutantResult,
    "outcome" | "strykerStatus" | "killedBy" | "baselineMs" | "limitMs" | "durationMs" | "reason"
  >,
): SoloMutantResult => ({
  mutantId: job.row.id,
  file: job.row.site.file,
  line: job.row.site.start.line,
  mutator: job.row.site.mutator,
  replacement: job.row.site.replacement,
  testFiles: job.testFiles,
  ...fields,
});

const expectedOriginalOf = (row: StrykerRow): string =>
  row.originalText.length >= STORED_ORIGINAL_LIMIT ? "" : row.originalText;

export const runSoloJobs = async (
  input: SoloInput,
  jobs: readonly SoloJob[],
): Promise<SoloBatch> => {
  const root = await repoRoot(input.cwd);
  ensureScaffoldIgnored(root);
  const recovery = recoverBackups(root);
  if (recovery.blockedByPid !== null) {
    return {
      ok: false,
      reason: `process ${recovery.blockedByPid} is mutating this worktree right now`,
    };
  }
  const needsHarness = jobs.some((job) => job.kind === "backend");
  const harness = harnessPathsOf(root);
  let templateBudget = Number.POSITIVE_INFINITY;
  if (needsHarness) {
    const status = await harnessStatus({ cwd: root });
    if (!status.running || !status.manifestReady) {
      return {
        ok: false,
        reason:
          "the backend harness is not running; call harnessStart for this worktree first",
      };
    }
    templateBudget = status.state?.templates.length ?? templateBudget;
  }
  const projectConfigFile = input.projectConfigFile ?? DEFAULT_PROJECT_CONFIG_FILE;
  const dbSetupFile = input.dbSetupFile ?? DEFAULT_DB_SETUP_FILE;
  const laneCount = Math.min(
    soloLaneCount(cpus().length, jobs.length),
    templateBudget - BASELINE_SLOTS,
  );
  const pool = input.lanes ?? soloLanePoolOf(root);
  const disposeOwnPool = (): void => {
    if (input.lanes === undefined) pool.dispose();
  };
  const lanes: (SoloLane | null)[] =
    laneCount > 1
      ? await pool.ensure(laneCount).catch((error: unknown) => {
          disposeOwnPool();
          throw error;
        })
      : [null];

  const configByWorkdir = new Map<string, string>();
  const configKey = (workdir: string, kind: ProjectKind): string =>
    `${workdir}|${kind}`;
  for (const workdir of [root, ...lanes.flatMap((lane) => (lane === null ? [] : [lane.root]))]) {
    for (const kind of PROJECT_KINDS) {
      const kindJobs = jobs.filter((job) => job.kind === kind);
      if (kindJobs.length === 0) continue;
      const { vitestConfigFile } = writeSoloScaffold({
        worktree: workdir,
        kind,
        projectConfigFile,
        dbSetupFile,
        manifestPath: harness.manifestPath,
        testFiles: [...new Set(kindJobs.flatMap((job) => job.testFiles))].sort(),
      });
      configByWorkdir.set(configKey(workdir, kind), vitestConfigFile);
    }
  }

  const reportFileOf = (workdir: string): string =>
    join(workdir, ...STRYKER_RUN_DIRECTORY.split("/"), "solo", "report.json");
  const baselines = new Map<string, Promise<number | null>>();
  const db = openDb();
  const results: (SoloMutantResult | undefined)[] = [];

  const baselineSlot = slotsOf(laneCount, BASELINE_SLOTS);
  const baselineOf = (
    job: SoloJob,
    lane: SoloLane | null,
    config: string,
    testNamePattern: string | null,
  ): Promise<number | null> => {
    const key = cacheKeyOf(job, testNamePattern);
    const known = baselines.get(key);
    if (known !== undefined) return known;
    const measure = (laneIndex: number) =>
      runVitestSolo({
        root,
        vitestConfigFile: config,
        testFiles: job.testFiles,
        limitMs: BASELINE_CEILING_MS,
        reportFile: reportFileOf(root),
        bail: false,
        testNamePattern,
        laneIndex,
      });
    const measuring = (
      lane === null ? measure(0) : baselineSlot((slot) => measure(slot))
    ).then((measured) => {
      const clean =
        !measured.timedOut &&
        measured.exitCode === 0 &&
        measured.failures.length === 0 &&
        measured.passed > 0;
      return clean ? measured.durationMs : null;
    });
    baselines.set(key, measuring);
    return measuring;
  };

  const settle = (position: number, job: SoloJob, result: SoloMutantResult): void => {
    if (input.record !== false) {
      recordSoloOutcome(
        db,
        job.row.id,
        result.outcome,
        result.strykerStatus,
        result.killedBy,
      );
    }
    results[position] = result;
  };

  const failedResult = (job: SoloJob, reason: string): SoloMutantResult =>
    resultOf(job, {
      outcome: "error",
      strykerStatus: "ErrorSolo",
      killedBy: [],
      baselineMs: null,
      limitMs: null,
      durationMs: 0,
      reason,
    });

  type JobRun =
    | { ok: true; observed: SoloVitestResult; baselineMs: number | null }
    | { ok: false; reason: string };

  const runJob = async (job: SoloJob, lane: SoloLane | null): Promise<JobRun> => {
    const workdir = lane?.root ?? root;
    const config = configByWorkdir.get(configKey(workdir, job.kind));
    if (config === undefined || job.testFiles.length === 0) {
      return { ok: false, reason: "the mutant has no covering test file" };
    }
    const unmeasured: JobRun = {
      ok: false,
      reason: "the covering tests do not pass without the mutation",
    };
    const testNamePattern = testNamePatternOf(job.row.coveredBy.map((test) => test.name));
    const eagerBaselineMs =
      lane === null ? await baselineOf(job, lane, config, testNamePattern) : null;
    if (lane === null && eagerBaselineMs === null) return unmeasured;
    let baselineMs = eagerBaselineMs;
    const lazyLimitMs = async (): Promise<number | null> => {
      baselineMs = await baselineOf(job, lane, config, testNamePattern);
      return baselineMs === null ? null : soloLimitMs(baselineMs);
    };
    const mutate = lane === null ? runMutated : runMutatedInLane;
    const ran = await mutate(
      workdir,
      job.row.site.file,
      (source) =>
        applyReplacement(source, job.row.site, expectedOriginalOf(job.row)),
      () =>
        runVitestSolo({
          root: workdir,
          vitestConfigFile: config,
          testFiles: job.testFiles,
          limitMs:
            eagerBaselineMs === null ? SOLO_LIMIT_FLOOR_MS : soloLimitMs(eagerBaselineMs),
          lazyLimitMs: lane === null ? undefined : lazyLimitMs,
          reportFile: reportFileOf(workdir),
          bail: input.bail ?? false,
          testNamePattern,
          laneIndex: lane?.index ?? 0,
        }),
    );
    if (!ran.ok) return ran;
    if (ran.value.unmeasured) return unmeasured;
    return { ok: true, observed: ran.value, baselineMs };
  };

  const finishJob = (position: number, job: SoloJob, run: JobRun): void => {
    if (!run.ok) {
      settle(position, job, failedResult(job, run.reason));
      return;
    }
    const { observed, baselineMs } = run;
    const verdict = verdictOf(observed);
    settle(
      position,
      job,
      resultOf(job, {
        outcome: verdict.outcome,
        strykerStatus: verdict.strykerStatus,
        killedBy: verdict.killedBy,
        baselineMs,
        limitMs: baselineMs === null ? null : soloLimitMs(baselineMs),
        durationMs: observed.durationMs,
        reason: null,
      }),
    );
  };

  let next = 0;
  const drain = async (lane: SoloLane | null): Promise<void> => {
    while (next < jobs.length) {
      const position = next;
      next += 1;
      const job = jobs[position];
      if (job !== undefined) finishJob(position, job, await runJob(job, lane));
    }
  };

  try {
    await Promise.all(lanes.map((lane) => drain(lane)));
  } finally {
    disposeOwnPool();
  }
  return {
    ok: true,
    results: results.filter((result) => result !== undefined),
    recoveredBackups: recovery.restored,
  };
};

export const timeoutRecheck = async (
  input: SoloInput,
): Promise<TimeoutRecheckResult> => {
  const startedAt = Date.now();
  const rows = strykerRowsOf(openDb(), input.runId).filter(
    (row) => row.outcome === "timeout_pending",
  );
  const batch = await runSoloJobs(input, rows.map(jobOf));
  if (!batch.ok) return batch;
  return {
    ok: true,
    runId: input.runId,
    ...summarizeSolo(batch.results, batch.recoveredBackups, startedAt),
  };
};
