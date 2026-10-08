import {
  BYTES_PER_GIB,
  defaultLimits,
  judgeHeadroom,
} from "../../domain/campaign/headroom.ts";
import {
  DEFAULT_DB_SETUP_FILE,
  DEFAULT_SEED_DB_NAME,
  seedTemplateNames,
} from "../../domain/campaign/templates.ts";
import {
  FAST_POSTGRES_SETTINGS,
  strykerConcurrency,
  templateCountFor,
} from "../../domain/stryker/settings.ts";
import {
  listRunningContainerIds,
  listSessionContainerIds,
  listTestContainerIds,
  removeContainers,
  sessionIdPublishing,
} from "../../infrastructure/docker.ts";
import {
  processAlive,
  signalProcess,
  spawnDetached,
  waitFor,
} from "../../infrastructure/detached.ts";
import {
  credentialHelperRefusal,
  dockerCredentialPath,
} from "../../infrastructure/docker-credentials.ts";
import { readTextFile } from "../../infrastructure/files.ts";
import { repoRoot } from "../../infrastructure/git.ts";
import { readHeadroom } from "../../infrastructure/headroom.ts";
import {
  BOOT_CONFIG_FILE,
  ensureScaffoldIgnored,
  harnessPathsOf,
  writeHarnessScaffold,
} from "../../infrastructure/stryker-files.ts";
import type { HarnessPaths } from "../../infrastructure/stryker-files.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import type {
  HarnessStartResult,
  HarnessState,
  HarnessStatusResult,
  HarnessStopResult,
} from "test-forge-contracts/stryker";

export type HarnessStartInput = {
  cwd: string;
  concurrency?: number | undefined;
  projectConfigFile?: string | undefined;
  globalSetupFile?: string | undefined;
  seedDbName?: string | undefined;
  dbSetupFile?: string | undefined;
  bootTimeoutMs?: number | undefined;
  holdTimeoutMs?: number | undefined;
  minimumFreeGb?: number | undefined;
};

export type HarnessCwdInput = { cwd: string };

export type HarnessStopInput = {
  cwd: string;
  drainTimeoutMs?: number | undefined;
};

const DEFAULT_BOOT_TIMEOUT_MS = 600_000;

const DEFAULT_HOLD_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const DEFAULT_DRAIN_TIMEOUT_MS = 180_000;

export const MAXIMUM_HARNESS_CONTAINERS = 8;

const MAX_LOG_TAIL = 3000;

export const DEFAULT_PROJECT_CONFIG_FILE = "vitest.config.mts";

export const DEFAULT_GLOBAL_SETUP_FILE =
  "tests/integration/setups/global-setup.ts";

export { DEFAULT_DB_SETUP_FILE };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const manifestIsReady = (path: string): boolean => {
  const text = readTextFile(path);
  if (text === null) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && parsed.ready === true;
  } catch {
    return false;
  }
};

const isHarnessState = (value: unknown): value is HarnessState =>
  isRecord(value) &&
  typeof value.pid === "number" &&
  typeof value.manifestPath === "string" &&
  Array.isArray(value.containerIds);

export const readHarnessState = (paths: HarnessPaths): HarnessState | null => {
  const text = readTextFile(paths.statePath);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isHarnessState(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const logTail = (path: string): string | null => {
  const text = readTextFile(path);
  return text === null ? null : text.slice(-MAX_LOG_TAIL);
};

const without = (ids: readonly string[], known: ReadonlySet<string>) =>
  ids.filter((id) => !known.has(id));

const databasePortOf = (manifestPath: string): number | null => {
  const text = readTextFile(manifestPath);
  if (text === null) return null;
  try {
    const manifest: unknown = JSON.parse(text);
    if (!isRecord(manifest) || !isRecord(manifest["env"])) return null;
    const url = manifest["env"]["__TEST_DB_URL__"];
    if (typeof url !== "string") return null;
    const port = Number(new URL(url).port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
};

const ownContainerIds = async (
  manifestPath: string,
  startedDuringBoot: readonly string[],
  path: string | undefined,
): Promise<string[]> => {
  const port = databasePortOf(manifestPath);
  const session = port === null ? null : await sessionIdPublishing(port, path);
  return session === null
    ? [...startedDuringBoot]
    : listSessionContainerIds(session, path);
};

const withDockerPath = async <TResult>(
  work: (path: string | undefined) => Promise<TResult>,
): Promise<TResult> => {
  const credentials = dockerCredentialPath();
  return work(credentials.ok ? credentials.path : undefined);
};

export const harnessStart = async ({
  cwd,
  concurrency,
  projectConfigFile = DEFAULT_PROJECT_CONFIG_FILE,
  globalSetupFile = DEFAULT_GLOBAL_SETUP_FILE,
  seedDbName = DEFAULT_SEED_DB_NAME,
  bootTimeoutMs = DEFAULT_BOOT_TIMEOUT_MS,
  holdTimeoutMs = DEFAULT_HOLD_TIMEOUT_MS,
  minimumFreeGb,
}: HarnessStartInput): Promise<HarnessStartResult> => {
  const worktree = await repoRoot(cwd);
  const paths = harnessPathsOf(worktree);
  const existing = readHarnessState(paths);
  if (
    existing !== null &&
    processAlive(existing.pid) &&
    manifestIsReady(paths.manifestPath)
  ) {
    return {
      ok: true,
      reused: true,
      state: existing,
      bootMs: 0,
      warnings: [],
    };
  }
  if (existing !== null) {
    await harnessStop({ cwd: worktree, drainTimeoutMs: 5_000 });
  }

  const credentials = dockerCredentialPath();
  if (!credentials.ok) {
    return {
      ok: false,
      bootLogTail: null,
      reason: credentialHelperRefusal(credentials.helper, credentials.searched),
    };
  }
  const limits = defaultLimits();
  if (minimumFreeGb !== undefined) {
    limits.minimumFreeBytes = minimumFreeGb * BYTES_PER_GIB;
  }
  const headroom = await readHeadroom(tmpdir());
  const guard = judgeHeadroom({ ...headroom, containerCount: null }, limits);
  if (!guard.ok) {
    return {
      ok: false,
      bootLogTail: null,
      reason: `refusing to start the harness: ${guard.breaches.join("; ")}`,
    };
  }

  ensureScaffoldIgnored(worktree);
  const workers = concurrency ?? strykerConcurrency(cpus().length);
  const templates = seedTemplateNames(seedDbName, templateCountFor(workers));
  rmSync(paths.directory, { recursive: true, force: true });
  mkdirSync(paths.directory, { recursive: true });
  writeHarnessScaffold({
    worktree,
    projectConfigFile,
    globalSetupFile,
    seedDbName,
    templates,
    fastPostgres: FAST_POSTGRES_SETTINGS,
    holdTimeoutMs,
    bootTimeoutMs,
    paths,
  });

  const before = new Set(await listTestContainerIds(credentials.path));
  const startedAt = Date.now();
  const started = spawnDetached({
    command: "npx",
    args: ["vitest", "run", "--config", BOOT_CONFIG_FILE],
    cwd: worktree,
    logPath: paths.bootLogPath,
    env: { FORCE_COLOR: "0", NO_COLOR: "1", PATH: credentials.path },
  });
  if (!started.ok) {
    return {
      ok: false,
      bootLogTail: null,
      reason: `boot process: ${started.reason}`,
    };
  }
  const state: HarnessState = {
    worktree,
    pid: started.pid,
    concurrency: workers,
    templates,
    manifestPath: paths.manifestPath,
    stopFilePath: paths.stopFilePath,
    bootLogPath: paths.bootLogPath,
    containerIds: [],
    startedAt: new Date(startedAt).toISOString(),
  };
  writeFileSync(paths.statePath, JSON.stringify(state, null, 2));

  const ready = await waitFor(
    () => manifestIsReady(paths.manifestPath) || !processAlive(started.pid),
    bootTimeoutMs,
    1000,
  );
  const containerIds = await ownContainerIds(
    paths.manifestPath,
    without(await listTestContainerIds(credentials.path), before),
    credentials.path,
  );
  const recorded: HarnessState = { ...state, containerIds };
  writeFileSync(paths.statePath, JSON.stringify(recorded, null, 2));
  if (containerIds.length > MAXIMUM_HARNESS_CONTAINERS) {
    await harnessStop({ cwd: worktree, drainTimeoutMs: 30_000 });
    return {
      ok: false,
      bootLogTail: null,
      reason: `the harness started ${containerIds.length} containers and the ceiling is ${MAXIMUM_HARNESS_CONTAINERS}`,
    };
  }
  if (!ready || !manifestIsReady(paths.manifestPath)) {
    const reason = processAlive(started.pid)
      ? `the harness was not ready after ${bootTimeoutMs}ms`
      : "the boot process exited before the harness was ready";
    const bootLogTail = logTail(paths.bootLogPath);
    await harnessStop({ cwd: worktree, drainTimeoutMs: 30_000 });
    return { ok: false, reason, bootLogTail };
  }
  return {
    ok: true,
    reused: false,
    state: recorded,
    bootMs: Date.now() - startedAt,
    warnings: [],
  };
};

export const harnessStatus = async ({
  cwd,
}: HarnessCwdInput): Promise<HarnessStatusResult> => {
  const worktree = await repoRoot(cwd);
  const paths = harnessPathsOf(worktree);
  const state = readHarnessState(paths);
  if (state === null) {
    return {
      running: false,
      manifestReady: false,
      state: null,
      liveContainerIds: [],
    };
  }
  const live = new Set(
    await withDockerPath((path) => listRunningContainerIds(path)),
  );
  return {
    running: processAlive(state.pid),
    manifestReady: manifestIsReady(paths.manifestPath),
    state,
    liveContainerIds: state.containerIds.filter((id) => live.has(id)),
  };
};

export const harnessStop = async ({
  cwd,
  drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
}: HarnessStopInput): Promise<HarnessStopResult> => {
  const worktree = await repoRoot(cwd);
  const paths = harnessPathsOf(worktree);
  const state = readHarnessState(paths);
  if (state === null) {
    return {
      ok: true,
      teardownClean: true,
      killed: false,
      removedContainerIds: [],
      leftoverContainerIds: [],
    };
  }
  mkdirSync(paths.directory, { recursive: true });
  writeFileSync(paths.stopFilePath, "stop");
  const teardownClean = await waitFor(
    () => !processAlive(state.pid),
    drainTimeoutMs,
    1000,
  );
  let killed = false;
  if (!teardownClean) {
    killed = signalProcess(state.pid, "SIGTERM");
    const gone = await waitFor(() => !processAlive(state.pid), 30_000, 1000);
    if (!gone) signalProcess(state.pid, "SIGKILL");
  }
  const result = await withDockerPath(async (path) => {
    const live = new Set(await listRunningContainerIds(path));
    const stillRunning = state.containerIds.filter((id) => live.has(id));
    await removeContainers(stillRunning, path);
    const after = new Set(await listRunningContainerIds(path));
    return {
      removedContainerIds: stillRunning,
      leftoverContainerIds: state.containerIds.filter((id) => after.has(id)),
    };
  });
  rmSync(paths.directory, { recursive: true, force: true });
  return {
    ok: result.leftoverContainerIds.length === 0,
    teardownClean,
    killed,
    ...result,
  };
};
