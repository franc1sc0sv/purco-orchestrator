import type { Kill } from "./mutation.ts";

export const SEED_TEMPLATE_ENV = "FORGE_SEED_TEMPLATES";

export const CAMPAIGN_STATES = [
  "starting",
  "ready",
  "stopping",
  "stopped",
  "failed",
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export const LANE_STATES = ["idle", "busy", "broken"] as const;

export type LaneState = (typeof LANE_STATES)[number];

export type CampaignLane = {
  laneNo: number;
  worktreePath: string;
  cacheDir: string;
  configPath: string;
  state: LaneState;
  mutantsRun: number;
};

export type Campaign = {
  campaignId: number;
  rootPath: string;
  baseDir: string;
  manifestPath: string;
  bootPid: number | null;
  bootLogPath: string;
  state: CampaignState;
  concurrency: number;
  detail: string;
  startedAt: string;
  endedAt: string | null;
};

export type CampaignWithLanes = Campaign & { lanes: CampaignLane[] };

export type Headroom = {
  freeDiskBytes: number;
  totalDiskBytes: number;
  containerCount: number | null;
  dockerReachable: boolean;
};

export type HeadroomLimits = {
  minimumFreeBytes: number;
  maximumContainers: number;
};

export type HeadroomVerdict = {
  ok: boolean;
  breaches: string[];
  headroom: Headroom;
  limits: HeadroomLimits;
};

export const BATCH_OUTCOMES = [
  "killed",
  "survived",
  "timeout",
  "error",
  "aborted",
] as const;

export type BatchOutcome = (typeof BATCH_OUTCOMES)[number];

export type BatchMutantResult = {
  mutantId: number;
  laneNo: number;
  outcome: BatchOutcome;
  attempts: number;
  infrastructureRetries: number;
  durationMs: number;
  killedBy: Kill[];
  reason: string | null;
  reusedProcess: boolean;
  processRetries: number;
};

export type BatchCounts = Record<BatchOutcome, number>;

export type ReuseReport = {
  enabled: boolean;
  batchSize: number;
  processesStarted: number;
  processesLost: number;
  mutantsOnReusedProcess: number;
  mutantsRetriedFresh: number;
};
