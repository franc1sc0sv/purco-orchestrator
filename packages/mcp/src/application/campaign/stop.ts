import { openDb } from "../../infrastructure/db/connection.ts";
import {
  findCampaign,
  listLanes,
  setCampaignState,
  toCampaign,
} from "../../infrastructure/db/campaign-store.ts";
import {
  processAlive,
  signalProcess,
  waitFor,
} from "../../infrastructure/detached.ts";
import { discardWorktree } from "../../infrastructure/worktree.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Campaign } from "test-forge-contracts/campaign";

export type CampaignStopInput = {
  cwd: string;
  campaignId: number;
  drainTimeoutMs?: number | undefined;
  keepWorktrees?: boolean | undefined;
};

export type CampaignStopResult =
  | {
      ok: true;
      campaign: Campaign;
      teardownClean: boolean;
      killed: boolean;
      removedWorktrees: number;
    }
  | { ok: false; reason: string };

const DEFAULT_DRAIN_TIMEOUT_MS = 180_000;

export const campaignStop = async ({
  campaignId,
  drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
  keepWorktrees = false,
}: CampaignStopInput): Promise<CampaignStopResult> => {
  const db = openDb();
  const row = findCampaign(db, campaignId);
  if (row === null) {
    return { ok: false, reason: `no campaign with id ${campaignId}` };
  }
  setCampaignState(db, campaignId, "stopping", "");

  const stopFile = join(row.base_dir, "stop");
  mkdirSync(row.base_dir, { recursive: true });
  writeFileSync(stopFile, "stop");

  const teardownClean = await waitFor(
    () => !processAlive(row.boot_pid),
    drainTimeoutMs,
    1000,
  );
  let killed = false;
  if (!teardownClean) {
    killed = signalProcess(row.boot_pid, "SIGTERM");
    const gone = await waitFor(() => !processAlive(row.boot_pid), 30_000, 1000);
    if (!gone) signalProcess(row.boot_pid, "SIGKILL");
  }

  let removedWorktrees = 0;
  if (!keepWorktrees) {
    for (const lane of listLanes(db, campaignId)) {
      await discardWorktree(
        row.root_path,
        lane.worktree_path,
        `${lane.worktree_path}.patch`,
      );
      removedWorktrees += 1;
    }
    const bootWorktree = join(row.base_dir, "boot");
    await discardWorktree(row.root_path, bootWorktree, `${bootWorktree}.patch`);
    removedWorktrees += 1;
    rmSync(row.base_dir, { recursive: true, force: true });
  }

  setCampaignState(
    db,
    campaignId,
    "stopped",
    teardownClean
      ? "the boot process ran its own teardown"
      : "the boot process was signalled, so container teardown may be incomplete",
  );
  const stopped = findCampaign(db, campaignId);
  if (stopped === null) {
    return { ok: false, reason: "the campaign row disappeared" };
  }
  return {
    ok: true,
    campaign: toCampaign(stopped),
    teardownClean,
    killed,
    removedWorktrees,
  };
};
