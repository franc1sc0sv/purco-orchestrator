import {
  BYTES_PER_GIB,
  defaultLimits,
  judgeHeadroom,
} from "../../domain/campaign/headroom.ts";
import {
  DEFAULT_DB_SETUP_FILE,
  DEFAULT_SEED_DB_NAME,
  boundedConcurrency,
  boundedLaneWorkers,
  laneTemplateNames,
  seedTemplateNames,
} from "../../domain/campaign/templates.ts";
import {
  BOOT_CONFIG_FILE,
  writeBootScaffold,
  writeLaneScaffold,
} from "../../infrastructure/campaign-files.ts";
import {
  insertCampaign,
  insertLane,
  listLanes,
  setBootPid,
  setCampaignState,
  toCampaign,
  toLane,
  findCampaign,
} from "../../infrastructure/db/campaign-store.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import {
  processAlive,
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
  discardWorktree,
  prepareWorktree,
  workingTreeFingerprint,
} from "../../infrastructure/worktree.ts";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CampaignLane,
  Campaign,
  HeadroomVerdict,
} from "test-forge-contracts/campaign";

export type CampaignStartInput = {
  cwd: string;
  concurrency?: number | undefined;
  projectConfigFile?: string | undefined;
  globalSetupFile?: string | undefined;
  laneWorkers?: number | undefined;
  bootTimeoutMs?: number | undefined;
  holdTimeoutMs?: number | undefined;
  minimumFreeGb?: number | undefined;
  maximumContainers?: number | undefined;
  seedDbName?: string | undefined;
  dbSetupFile?: string | undefined;
};

export type CampaignStartResult =
  | {
      ok: true;
      campaign: Campaign;
      lanes: CampaignLane[];
      templates: string[];
      headroom: HeadroomVerdict;
      warnings: string[];
    }
  | {
      ok: false;
      reason: string;
      campaignId: number | null;
      headroom: HeadroomVerdict | null;
      bootLogTail: string | null;
    };

const DEFAULT_BOOT_TIMEOUT_MS = 600_000;

const DEFAULT_HOLD_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const MAX_LOG_TAIL = 3000;

const logTail = (path: string): string | null => {
  const text = readTextFile(path);
  return text === null ? null : text.slice(-MAX_LOG_TAIL);
};

const manifestIsReady = (path: string): boolean => {
  const text = readTextFile(path);
  if (text === null) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { ready?: unknown }).ready === true
    );
  } catch {
    return false;
  }
};

export const campaignStart = async ({
  cwd,
  concurrency,
  projectConfigFile = "vitest.config.mts",
  globalSetupFile = "tests/integration/setups/global-setup.ts",
  laneWorkers,
  bootTimeoutMs = DEFAULT_BOOT_TIMEOUT_MS,
  holdTimeoutMs = DEFAULT_HOLD_TIMEOUT_MS,
  minimumFreeGb,
  maximumContainers,
  seedDbName = DEFAULT_SEED_DB_NAME,
  dbSetupFile = DEFAULT_DB_SETUP_FILE,
}: CampaignStartInput): Promise<CampaignStartResult> => {
  const root = await repoRoot(cwd);
  const credentials = dockerCredentialPath();
  if (!credentials.ok) {
    return {
      ok: false,
      campaignId: null,
      headroom: null,
      bootLogTail: null,
      reason: credentialHelperRefusal(credentials.helper, credentials.searched),
    };
  }

  const limits = defaultLimits();
  if (minimumFreeGb !== undefined) {
    limits.minimumFreeBytes = minimumFreeGb * BYTES_PER_GIB;
  }
  if (maximumContainers !== undefined) {
    limits.maximumContainers = maximumContainers;
  }

  const guard = judgeHeadroom(await readHeadroom(tmpdir()), limits);
  if (!guard.ok) {
    return {
      ok: false,
      campaignId: null,
      headroom: guard,
      bootLogTail: null,
      reason: `refusing to start the campaign: ${guard.breaches.join("; ")}`,
    };
  }

  const lanes = boundedConcurrency(concurrency);
  const workersPerLane = boundedLaneWorkers(laneWorkers, lanes);
  const templates = seedTemplateNames(seedDbName, lanes * workersPerLane);
  const requestedBaseDir = join(
    tmpdir(),
    `test-forge-campaign-${process.pid}-${Date.now()}`
  );
  mkdirSync(requestedBaseDir, { recursive: true });
  const baseDir = realpathSync(requestedBaseDir);
  const manifestPath = join(baseDir, "manifest.json");
  const stopFilePath = join(baseDir, "stop");
  const bootLogPath = join(baseDir, "boot.log");
  const bootWorktree = join(baseDir, "boot");
  rmSync(stopFilePath, { force: true });
  rmSync(manifestPath, { force: true });

  const db = openDb();
  const campaignId = insertCampaign(db, {
    rootPath: root,
    baseDir,
    manifestPath,
    bootLogPath,
    concurrency: lanes,
  });

  const warnings: string[] = [];
  const created: string[] = [];

  const abandon = async (reason: string): Promise<CampaignStartResult> => {
    const bootLogTail = logTail(bootLogPath);
    for (const path of created) {
      await discardWorktree(root, path, `${path}.patch`);
    }
    rmSync(baseDir, { recursive: true, force: true });
    setCampaignState(db, campaignId, "failed", reason);
    return { ok: false, reason, campaignId, headroom: guard, bootLogTail };
  };

  const boot = await prepareWorktree(root, bootWorktree);
  warnings.push(...boot.warnings);
  if (!boot.ok) return abandon(`boot worktree: ${boot.reason}`);
  created.push(bootWorktree);

  writeBootScaffold({
    worktree: bootWorktree,
    projectConfigFile,
    globalSetupFile,
    manifestPath,
    stopFilePath,
    cacheDir: join(baseDir, "cache", "boot"),
    holdTimeoutMs,
    bootTimeoutMs,
    seedDbName,
    templates,
  });

  const started = spawnDetached({
    command: "npx",
    args: ["vitest", "run", "--config", BOOT_CONFIG_FILE],
    cwd: bootWorktree,
    logPath: bootLogPath,
    env: { FORCE_COLOR: "0", NO_COLOR: "1", PATH: credentials.path },
  });
  if (!started.ok) return abandon(`boot process: ${started.reason}`);
  setBootPid(db, campaignId, started.pid);

  const ready = await waitFor(
    () => manifestIsReady(manifestPath) || !processAlive(started.pid),
    bootTimeoutMs,
    1000
  );
  if (!ready || !manifestIsReady(manifestPath)) {
    return abandon(
      processAlive(started.pid)
        ? `the campaign environment was not ready after ${bootTimeoutMs}ms`
        : "the boot process exited before the campaign environment was ready"
    );
  }

  for (let laneNo = 1; laneNo <= lanes; laneNo += 1) {
    const worktree = join(baseDir, `lane-${laneNo}`);
    const prepared = await prepareWorktree(root, worktree);
    warnings.push(...prepared.warnings);
    if (!prepared.ok) return abandon(`lane ${laneNo}: ${prepared.reason}`);
    created.push(worktree);
    const cacheDir = join(baseDir, "cache", `lane-${laneNo}`);
    mkdirSync(cacheDir, { recursive: true });
    const scaffold = writeLaneScaffold({
      worktree,
      projectConfigFile,
      manifestPath,
      cacheDir,
      laneWorkers: workersPerLane,
      dbSetupFile,
      templates: laneTemplateNames({
        all: templates,
        laneNo,
        laneWorkers: workersPerLane,
      }),
    });
    insertLane(db, {
      campaignId,
      laneNo,
      worktreePath: worktree,
      cacheDir,
      configPath: scaffold.configFile,
    });
  }

  writeFileSync(fingerprintFileOf(baseDir), await workingTreeFingerprint(root));
  setCampaignState(db, campaignId, "ready", "");
  const row = findCampaign(db, campaignId);
  if (row === null) return abandon("the campaign row disappeared");

  return {
    ok: true,
    campaign: toCampaign(row),
    lanes: listLanes(db, campaignId).map(toLane),
    templates,
    headroom: guard,
    warnings,
  };
};

export const stopFileOf = (baseDir: string): string => join(baseDir, "stop");

export const fingerprintFileOf = (baseDir: string): string =>
  join(baseDir, "source.fingerprint");
