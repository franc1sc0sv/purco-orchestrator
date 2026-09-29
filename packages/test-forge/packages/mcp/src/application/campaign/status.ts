import {
  BYTES_PER_GIB,
  defaultLimits,
  judgeHeadroom,
} from "../../domain/campaign/headroom.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import {
  findCampaign,
  latestReadyCampaign,
  listCampaigns,
  listLanes,
  toCampaign,
  toLane,
} from "../../infrastructure/db/campaign-store.ts";
import { processAlive } from "../../infrastructure/detached.ts";
import { readTextFile } from "../../infrastructure/files.ts";
import { repoRoot } from "../../infrastructure/git.ts";
import { readHeadroom } from "../../infrastructure/headroom.ts";
import { tmpdir } from "node:os";
import type {
  Campaign,
  CampaignLane,
  HeadroomVerdict,
} from "test-forge-contracts/campaign";

export type CampaignStatusInput = {
  cwd: string;
  campaignId?: number | undefined;
  minimumFreeGb?: number | undefined;
  maximumContainers?: number | undefined;
};

export type CampaignStatusResult =
  | {
      ok: true;
      campaign: Campaign;
      lanes: CampaignLane[];
      bootAlive: boolean;
      manifestReady: boolean;
      carriedEnvKeys: string[];
      headroom: HeadroomVerdict;
      bootLogTail: string | null;
    }
  | { ok: false; reason: string; openCampaignIds: number[] };

const MAX_LOG_TAIL = 2000;

type Manifest = { ready?: unknown; env?: Record<string, string> };

const readManifest = (path: string): Manifest | null => {
  const text = readTextFile(path);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Manifest)
      : null;
  } catch {
    return null;
  }
};

export const limitsFrom = (
  minimumFreeGb: number | undefined,
  maximumContainers: number | undefined,
): { minimumFreeBytes: number; maximumContainers: number } => {
  const limits = defaultLimits();
  if (minimumFreeGb !== undefined) {
    limits.minimumFreeBytes = minimumFreeGb * BYTES_PER_GIB;
  }
  if (maximumContainers !== undefined) {
    limits.maximumContainers = maximumContainers;
  }
  return limits;
};

export const resolveCampaignId = async (
  cwd: string,
  campaignId: number | undefined,
): Promise<number | null> => {
  if (campaignId !== undefined) return campaignId;
  const db = openDb();
  const row = latestReadyCampaign(db, await repoRoot(cwd));
  return row === null ? null : row.id;
};

export const campaignStatus = async ({
  cwd,
  campaignId,
  minimumFreeGb,
  maximumContainers,
}: CampaignStatusInput): Promise<CampaignStatusResult> => {
  const db = openDb();
  const resolved = await resolveCampaignId(cwd, campaignId);
  const row = resolved === null ? null : findCampaign(db, resolved);
  if (row === null) {
    return {
      ok: false,
      reason:
        campaignId === undefined
          ? "no ready campaign exists for this repository; call mutation_campaign_start first"
          : `no campaign with id ${campaignId}`,
      openCampaignIds: listCampaigns(db).map((entry) => entry.id),
    };
  }

  const manifest = readManifest(row.manifest_path);
  const headroom = judgeHeadroom(
    await readHeadroom(tmpdir()),
    limitsFrom(minimumFreeGb, maximumContainers),
  );
  const log = readTextFile(row.boot_log_path);

  return {
    ok: true,
    campaign: toCampaign(row),
    lanes: listLanes(db, row.id).map(toLane),
    bootAlive: processAlive(row.boot_pid),
    manifestReady: manifest?.ready === true,
    carriedEnvKeys: Object.keys(manifest?.env ?? {}).sort(),
    headroom,
    bootLogTail: log === null ? null : log.slice(-MAX_LOG_TAIL),
  };
};
