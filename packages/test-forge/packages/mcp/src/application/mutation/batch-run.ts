import {
  infrastructureFailure,
  infrastructureSignatureIn,
} from "../../domain/campaign/failure.ts";
import { judgeHeadroom } from "../../domain/campaign/headroom.ts";
import {
  boundedReuseBatch,
  boundedSlots,
  chunked,
  runPool,
} from "../../domain/campaign/pool.ts";
import {
  composeCommand,
  detectFamily,
} from "../../domain/execution/command.ts";
import { parseReport } from "../../domain/execution/report.ts";
import {
  DRIVER_FILE,
  scaffoldPath,
  writeDriverScaffold,
} from "../../infrastructure/campaign-files.ts";
import {
  countLaneRun,
  findCampaign,
  listLanes,
  recordAttempt,
  setLaneState,
  toLane,
} from "../../infrastructure/db/campaign-store.ts";
import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { recordKills } from "../../infrastructure/db/kill-store.ts";
import type { MutantRow } from "../../infrastructure/db/rows.ts";
import { sleep } from "../../infrastructure/detached.ts";
import { readTextFile } from "../../infrastructure/files.ts";
import {
  readContainers,
  readDisk,
  readDiskOnlyHeadroom,
} from "../../infrastructure/headroom.ts";
import type { LaneDriver } from "../../infrastructure/lane-driver.ts";
import { startLaneDriver } from "../../infrastructure/lane-driver.ts";
import {
  DEFAULT_TIMEOUT_MS,
  boundedTimeout,
  runProcess,
} from "../../infrastructure/process.ts";
import {
  refreshWorktree,
  swapLine,
  toRepoRelative,
  workingTreeFingerprint,
} from "../../infrastructure/worktree.ts";
import { fingerprintFileOf } from "../campaign/start.ts";
import { limitsFrom, resolveCampaignId } from "../campaign/status.ts";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BatchCounts,
  BatchMutantResult,
  BatchOutcome,
  CampaignLane,
  HeadroomVerdict,
  ReuseReport,
} from "test-forge-contracts/campaign";
import type { ParsedRun, RunnerFamily } from "test-forge-contracts/execution";
import type { Kill } from "test-forge-contracts/mutation";

export type MutationBatchRunInput = {
  cwd: string;
  mutantIds: readonly number[];
  tests: readonly string[];
  campaignId?: number | undefined;
  concurrency?: number | undefined;
  command?: string | undefined;
  timeoutMs?: number | undefined;
  bail?: boolean | undefined;
  seedCopyRetries?: number | undefined;
  staggerMs?: number | undefined;
  includeKills?: boolean | undefined;
  refreshLanes?: boolean | undefined;
  minimumFreeGb?: number | undefined;
  maximumContainers?: number | undefined;
  reuseProcess?: boolean | undefined;
  reuseBatchSize?: number | undefined;
};

export type MutationBatchRunResult =
  | {
      ok: true;
      campaignId: number;
      lanes: number;
      counts: BatchCounts;
      results: BatchMutantResult[];
      aborted: boolean;
      abortReason: string | null;
      headroom: HeadroomVerdict;
      reuse: ReuseReport;
      durationMs: number;
    }
  | { ok: false; reason: string };

type Attempt = {
  outcome: BatchOutcome;
  kills: Kill[];
  reason: string | null;
  infrastructure: string | null;
  durationMs: number;
};

type MutantSlice = Pick<
  MutantRow,
  "id" | "file_path" | "line" | "before_text" | "after_text"
>;

const CONTAINER_CHECK_EVERY = 10;

const RETRY_BACKOFF_MS = 2_000;

const MAX_REASON_CHARS = 400;

const emptyCounts = (): BatchCounts => ({
  killed: 0,
  survived: 0,
  timeout: 0,
  error: 0,
  aborted: 0,
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const trimmed = (text: string): string => text.slice(0, MAX_REASON_CHARS);

const parsedOrNull = (family: RunnerFamily, text: string): ParsedRun | null => {
  try {
    return parseReport(family, text);
  } catch {
    return null;
  }
};

const parsedFileOrNull = (
  family: RunnerFamily,
  reportPath: string
): ParsedRun | null => {
  const fileText = readTextFile(reportPath);
  if (fileText === null || fileText.trim() === "") return null;
  return parsedOrNull(family, fileText);
};

const readReport = (
  reportPath: string,
  stdout: string,
  command: string
): ParsedRun | null => {
  const family = detectFamily(command);
  return parsedFileOrNull(family, reportPath) ?? parsedOrNull(family, stdout);
};

type RunSignals = {
  worktreePath: string;
  timedOut: boolean;
  timeoutMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  report: ParsedRun | null;
};

const classifyRun = ({
  worktreePath,
  timedOut,
  timeoutMs,
  exitCode,
  stdout,
  stderr,
  report,
}: RunSignals): Omit<Attempt, "durationMs"> => {
  if (timedOut) {
    return {
      outcome: "timeout",
      kills: [],
      reason: `the run exceeded ${String(timeoutMs)}ms`,
      infrastructure: null,
    };
  }

  if (report === null) {
    return {
      outcome: "error",
      kills: [],
      reason: trimmed(
        `no test report could be read (exit ${String(exitCode)}): ${
          stderr.slice(-MAX_REASON_CHARS) || stdout.slice(-MAX_REASON_CHARS)
        }`
      ),
      infrastructure: infrastructureSignatureIn(`${stderr}\n${stdout}`),
    };
  }

  const signature = infrastructureFailure(report.failures);
  if (signature !== null) {
    return {
      outcome: "error",
      kills: [],
      reason: trimmed(
        `the test environment failed, not the mutant: ${
          report.failures[0]?.message ?? signature
        }`
      ),
      infrastructure: signature,
    };
  }

  if (report.failures.length > 0) {
    return {
      outcome: "killed",
      kills: report.failures.map((failure) => ({
        file: toRepoRelative(worktreePath, failure.file),
        name: failure.testName,
      })),
      reason: null,
      infrastructure: null,
    };
  }

  if (exitCode !== 0) {
    return {
      outcome: "error",
      kills: [],
      reason: trimmed(
        `the runner exited ${String(
          exitCode
        )} with no failing test: ${stderr.slice(-MAX_REASON_CHARS)}`
      ),
      infrastructure: infrastructureSignatureIn(`${stderr}\n${stdout}`),
    };
  }

  return { outcome: "survived", kills: [], reason: null, infrastructure: null };
};

const applyMutant = (
  lane: CampaignLane,
  mutant: MutantSlice
): { ok: true; targetPath: string } | { ok: false; reason: string } => {
  const targetPath = join(lane.worktreePath, mutant.file_path);
  const applied = swapLine(
    targetPath,
    mutant.line,
    mutant.before_text,
    mutant.after_text
  );
  return applied.ok
    ? { ok: true, targetPath }
    : { ok: false, reason: applied.reason };
};

const revertMutant = (
  lane: CampaignLane,
  mutant: MutantSlice,
  targetPath: string
): void => {
  const reverted = swapLine(
    targetPath,
    mutant.line,
    mutant.after_text,
    mutant.before_text
  );
  if (!reverted.ok) throw new Error(`lane ${lane.laneNo}: ${reverted.reason}`);
};

const runOnce = async ({
  lane,
  mutant,
  testArguments,
  command,
  timeoutMs,
  bail,
}: {
  lane: CampaignLane;
  mutant: MutantSlice;
  testArguments: readonly string[];
  command: string;
  timeoutMs: number | undefined;
  bail: boolean;
}): Promise<Attempt> => {
  const startedAt = Date.now();
  const applied = applyMutant(lane, mutant);
  if (!applied.ok) {
    return {
      outcome: "error",
      kills: [],
      reason: applied.reason,
      infrastructure: null,
      durationMs: Date.now() - startedAt,
    };
  }

  const reportPath = join(lane.cacheDir, `report-${mutant.id}.json`);
  const fullCommand = composeCommand(command, [
    `--config=${lane.configPath}`,
    "--reporter=json",
    `--outputFile=${reportPath}`,
    ...(bail ? ["--bail=1"] : []),
    ...testArguments,
  ]);

  try {
    const execution = await runProcess({
      command: fullCommand,
      cwd: lane.worktreePath,
      shell: true,
      timeoutMs,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      env: { FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    return {
      ...classifyRun({
        worktreePath: lane.worktreePath,
        timedOut: execution.timedOut,
        timeoutMs: execution.timeoutMs,
        exitCode: execution.code,
        stdout: execution.stdout,
        stderr: execution.stderr,
        report: execution.timedOut
          ? null
          : readReport(reportPath, execution.stdout, fullCommand),
      }),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    rmSync(reportPath, { force: true });
    revertMutant(lane, mutant, applied.targetPath);
  }
};

const runReused = async ({
  driver,
  lane,
  mutant,
  command,
  timeoutMs,
}: {
  driver: LaneDriver;
  lane: CampaignLane;
  mutant: MutantSlice;
  command: string;
  timeoutMs: number;
}): Promise<Attempt | null> => {
  const startedAt = Date.now();
  const applied = applyMutant(lane, mutant);
  if (!applied.ok) {
    return {
      outcome: "error",
      kills: [],
      reason: applied.reason,
      infrastructure: null,
      durationMs: Date.now() - startedAt,
    };
  }

  const reportPath = join(lane.cacheDir, `report-${mutant.id}.json`);
  try {
    const answered = await driver.run(
      {
        mutantId: mutant.id,
        invalidate: [applied.targetPath],
        reportPath,
      },
      timeoutMs
    );
    if (!answered.ok) return null;
    const outcome = answered.result;
    return {
      ...classifyRun({
        worktreePath: lane.worktreePath,
        timedOut: false,
        timeoutMs,
        exitCode: outcome.error === null ? 0 : 1,
        stdout: driver.diagnostics(),
        stderr: outcome.error ?? "",
        report: outcome.report ? readReport(reportPath, "", command) : null,
      }),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    rmSync(reportPath, { force: true });
    revertMutant(lane, mutant, applied.targetPath);
  }
};

export const mutationBatchRun = async ({
  cwd,
  mutantIds,
  tests,
  campaignId,
  concurrency,
  command = "npx vitest run",
  timeoutMs,
  bail = false,
  seedCopyRetries = 2,
  staggerMs = 750,
  includeKills = false,
  refreshLanes = false,
  minimumFreeGb,
  maximumContainers,
  reuseProcess = false,
  reuseBatchSize,
}: MutationBatchRunInput): Promise<MutationBatchRunResult> => {
  const db = openDb();
  const resolved = await resolveCampaignId(cwd, campaignId);
  const campaign = resolved === null ? null : findCampaign(db, resolved);
  if (campaign === null) {
    return {
      ok: false,
      reason:
        "no campaign to run in; call mutation_campaign_start first, or pass campaignId",
    };
  }
  if (campaign.state !== "ready") {
    return {
      ok: false,
      reason: `campaign ${campaign.id} is ${campaign.state}, not ready`,
    };
  }

  const lanes = listLanes(db, campaign.id).map(toLane);
  if (lanes.length === 0) {
    return { ok: false, reason: `campaign ${campaign.id} has no lanes` };
  }

  const fingerprintFile = fingerprintFileOf(campaign.base_dir);
  const fingerprint = await workingTreeFingerprint(campaign.root_path);
  if (readTextFile(fingerprintFile) !== fingerprint) {
    if (!refreshLanes) {
      return {
        ok: false,
        reason:
          "the working tree changed since the campaign started, so the lanes hold stale source; run again with refreshLanes true, or start a new campaign",
      };
    }
    for (const lane of lanes) {
      const refreshed = await refreshWorktree(
        campaign.root_path,
        lane.worktreePath
      );
      if (!refreshed.ok) {
        return {
          ok: false,
          reason: `lane ${lane.laneNo} could not be refreshed: ${refreshed.reason}`,
        };
      }
    }
    writeFileSync(fingerprintFile, fingerprint);
  }

  const mutants = mutantIds
    .map((mutantId) =>
      one<MutantSlice>(
        db,
        "SELECT id, file_path, line, before_text, after_text FROM mutants WHERE id = ?",
        [mutantId]
      )
    )
    .filter((mutant): mutant is MutantSlice => mutant !== null);
  if (mutants.length === 0) {
    return { ok: false, reason: "none of the given mutant ids exist" };
  }

  const limits = limitsFrom(minimumFreeGb, maximumContainers);
  const testArguments = tests.map((test) =>
    toRepoRelative(campaign.root_path, test)
  );
  const slots = boundedSlots(concurrency ?? lanes.length, lanes.length);
  const startedAt = Date.now();

  let abortReason: string | null = null;
  let dispatched = 0;
  let lastHeadroom = judgeHeadroom(
    readDiskOnlyHeadroom(campaign.base_dir),
    limits
  );

  const guardBeforeDispatch = async (): Promise<boolean> => {
    if (abortReason !== null) return false;
    const disk = readDisk(campaign.base_dir);
    const containers =
      dispatched % CONTAINER_CHECK_EVERY === 0
        ? await readContainers()
        : {
            containerCount: lastHeadroom.headroom.containerCount,
            dockerReachable: lastHeadroom.headroom.dockerReachable,
          };
    dispatched += 1;
    lastHeadroom = judgeHeadroom({ ...disk, ...containers }, limits);
    if (!lastHeadroom.ok) {
      abortReason = `aborted mid-run: ${lastHeadroom.breaches.join("; ")}`;
      return false;
    }
    return true;
  };

  const record = (
    mutant: MutantSlice,
    laneNo: number,
    attempt: Attempt,
    attempts: number,
    infrastructureRetries: number,
    reusedProcess: boolean,
    processRetries: number
  ): BatchMutantResult => {
    tx(db, (txScope) => {
      if (attempt.outcome !== "aborted") {
        run(txScope.db, "UPDATE mutants SET outcome = ? WHERE id = ?", [
          attempt.outcome,
          mutant.id,
        ]);
      }
      recordKills({
        db: txScope.db,
        mutantId: mutant.id,
        kills: attempt.kills,
        attributionComplete: !bail,
      });
      recordAttempt(txScope.db, {
        campaignId: campaign.id,
        mutantId: mutant.id,
        laneNo,
        attempt: attempts,
        outcome: attempt.outcome,
        infrastructure: attempt.infrastructure !== null,
        durationMs: attempt.durationMs,
        reason: attempt.reason ?? "",
      });
      if (attempt.outcome !== "aborted") {
        countLaneRun(txScope.db, campaign.id, laneNo);
      }
    });
    return {
      mutantId: mutant.id,
      laneNo,
      outcome: attempt.outcome,
      attempts,
      infrastructureRetries,
      durationMs: Math.round(attempt.durationMs),
      killedBy: includeKills ? attempt.kills : [],
      reason: attempt.reason,
      reusedProcess,
      processRetries,
    };
  };

  const abortedAttempt = (): Attempt => ({
    outcome: "aborted",
    kills: [],
    reason: abortReason,
    infrastructure: null,
    durationMs: 0,
  });

  const laneOf = (slot: number): CampaignLane => {
    const lane = lanes[slot] ?? lanes[0];
    if (lane === undefined) {
      throw new Error("the campaign lost its lanes mid-run");
    }
    return lane;
  };

  const freshWithRetries = async (
    lane: CampaignLane,
    mutant: MutantSlice
  ): Promise<{
    attempt: Attempt;
    attempts: number;
    infrastructureRetries: number;
  }> => {
    let attempts = 0;
    let infrastructureRetries = 0;
    let last: Attempt = {
      outcome: "error",
      kills: [],
      reason: "the mutant was never run",
      infrastructure: null,
      durationMs: 0,
    };
    while (attempts <= seedCopyRetries) {
      attempts += 1;
      try {
        last = await runOnce({
          lane,
          mutant,
          testArguments,
          command,
          timeoutMs,
          bail,
        });
      } catch (error) {
        setLaneState(db, campaign.id, lane.laneNo, "broken");
        abortReason = `lane ${lane.laneNo} could not be restored: ${messageOf(
          error
        )}`;
        last = {
          outcome: "error",
          kills: [],
          reason: abortReason,
          infrastructure: null,
          durationMs: 0,
        };
        break;
      }
      if (last.infrastructure === null) break;
      infrastructureRetries += 1;
      if (attempts > seedCopyRetries) break;
      await sleep(RETRY_BACKOFF_MS * infrastructureRetries);
    }
    return { attempt: last, attempts, infrastructureRetries };
  };

  const batchSize = boundedReuseBatch(reuseBatchSize);
  const reuse: ReuseReport = {
    enabled: reuseProcess,
    batchSize,
    processesStarted: 0,
    processesLost: 0,
    mutantsOnReusedProcess: 0,
    mutantsRetriedFresh: 0,
  };

  const openDriver = async (lane: CampaignLane): Promise<LaneDriver | null> => {
    const rawReportPath = join(lane.cacheDir, "driver-report.json");
    writeDriverScaffold({
      worktree: lane.worktreePath,
      configPath: join(lane.worktreePath, lane.configPath),
      rawReportPath,
      filters: testArguments,
      bail,
    });
    const started = await startLaneDriver({
      driverPath: scaffoldPath(lane.worktreePath, DRIVER_FILE),
      cwd: lane.worktreePath,
      env: { FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    reuse.processesStarted += 1;
    if (started.ok) return started.driver;
    reuse.processesLost += 1;
    return null;
  };

  const runGroup = async (
    group: readonly MutantSlice[],
    slot: number
  ): Promise<BatchMutantResult[]> => {
    const lane = laneOf(slot);
    let driver = await openDriver(lane);
    const recorded: BatchMutantResult[] = [];

    for (const mutant of group) {
      if (!(await guardBeforeDispatch())) {
        recorded.push(
          record(mutant, lane.laneNo, abortedAttempt(), 0, 0, false, 0)
        );
        continue;
      }
      if (driver !== null) {
        let reused: Attempt | null = null;
        try {
          reused = await runReused({
            driver,
            lane,
            mutant,
            command,
            timeoutMs: boundedTimeout(timeoutMs, DEFAULT_TIMEOUT_MS),
          });
        } catch (error) {
          setLaneState(db, campaign.id, lane.laneNo, "broken");
          abortReason = `lane ${lane.laneNo} could not be restored: ${messageOf(
            error
          )}`;
          recorded.push(
            record(
              mutant,
              lane.laneNo,
              {
                outcome: "error",
                kills: [],
                reason: abortReason,
                infrastructure: null,
                durationMs: 0,
              },
              1,
              0,
              true,
              0
            )
          );
          await driver.stop();
          driver = null;
          continue;
        }
        if (reused !== null && reused.infrastructure === null) {
          reuse.mutantsOnReusedProcess += 1;
          recorded.push(record(mutant, lane.laneNo, reused, 1, 0, true, 0));
          continue;
        }
        if (reused === null) {
          reuse.processesLost += 1;
          await driver.stop();
          driver = null;
        }
      }

      reuse.mutantsRetriedFresh += 1;
      const fresh = await freshWithRetries(lane, mutant);
      recorded.push(
        record(
          mutant,
          lane.laneNo,
          fresh.attempt,
          fresh.attempts,
          fresh.infrastructureRetries,
          false,
          1
        )
      );
    }

    if (driver !== null) await driver.stop();
    return recorded;
  };

  const runSingle = async (
    mutant: MutantSlice,
    slot: number
  ): Promise<BatchMutantResult> => {
    const lane = laneOf(slot);
    if (!(await guardBeforeDispatch())) {
      return record(mutant, lane.laneNo, abortedAttempt(), 0, 0, false, 0);
    }
    const fresh = await freshWithRetries(lane, mutant);
    return record(
      mutant,
      lane.laneNo,
      fresh.attempt,
      fresh.attempts,
      fresh.infrastructureRetries,
      false,
      0
    );
  };

  const results = reuseProcess
    ? (
        await runPool(
          chunked(mutants, batchSize),
          { slots, staggerMs },
          runGroup
        )
      ).flat()
    : await runPool(mutants, { slots, staggerMs }, runSingle);

  const counts = emptyCounts();
  for (const result of results) counts[result.outcome] += 1;

  return {
    ok: true,
    campaignId: campaign.id,
    lanes: slots,
    counts,
    results,
    aborted: abortReason !== null,
    abortReason,
    headroom: lastHeadroom,
    reuse,
    durationMs: Date.now() - startedAt,
  };
};
