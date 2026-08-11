import { all, one, run } from "./connection.ts";
import type { DatabaseSync } from "node:sqlite";
import type {
  Campaign,
  CampaignLane,
  CampaignState,
  LaneState,
} from "test-forge-contracts/campaign";

export type CampaignRow = {
  id: number;
  root_path: string;
  base_dir: string;
  manifest_path: string;
  boot_log_path: string;
  boot_pid: number | null;
  concurrency: number;
  state: CampaignState;
  detail: string;
  started_at: string;
  ended_at: string | null;
};

export type CampaignLaneRow = {
  id: number;
  campaign_id: number;
  lane_no: number;
  worktree_path: string;
  cache_dir: string;
  config_path: string;
  state: LaneState;
  mutants_run: number;
};

export const toCampaign = (row: CampaignRow): Campaign => ({
  campaignId: row.id,
  rootPath: row.root_path,
  baseDir: row.base_dir,
  manifestPath: row.manifest_path,
  bootPid: row.boot_pid,
  bootLogPath: row.boot_log_path,
  state: row.state,
  concurrency: row.concurrency,
  detail: row.detail,
  startedAt: row.started_at,
  endedAt: row.ended_at,
});

export const toLane = (row: CampaignLaneRow): CampaignLane => ({
  laneNo: row.lane_no,
  worktreePath: row.worktree_path,
  cacheDir: row.cache_dir,
  configPath: row.config_path,
  state: row.state,
  mutantsRun: row.mutants_run,
});

export const insertCampaign = (
  db: DatabaseSync,
  values: {
    rootPath: string;
    baseDir: string;
    manifestPath: string;
    bootLogPath: string;
    concurrency: number;
  },
): number => {
  const summary = run(
    db,
    `INSERT INTO campaigns (root_path, base_dir, manifest_path, boot_log_path, concurrency, state)
     VALUES (?, ?, ?, ?, ?, 'starting')`,
    [
      values.rootPath,
      values.baseDir,
      values.manifestPath,
      values.bootLogPath,
      values.concurrency,
    ],
  );
  return Number(summary.lastInsertRowid);
};

export const setCampaignState = (
  db: DatabaseSync,
  campaignId: number,
  state: CampaignState,
  detail = "",
): void => {
  run(
    db,
    `UPDATE campaigns
        SET state = ?,
            detail = ?,
            ended_at = CASE WHEN ? IN ('stopped', 'failed')
                            THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                            ELSE ended_at END
      WHERE id = ?`,
    [state, detail, state, campaignId],
  );
};

export const setBootPid = (
  db: DatabaseSync,
  campaignId: number,
  pid: number,
): void => {
  run(db, `UPDATE campaigns SET boot_pid = ? WHERE id = ?`, [pid, campaignId]);
};

export const findCampaign = (
  db: DatabaseSync,
  campaignId: number,
): CampaignRow | null =>
  one<CampaignRow>(db, `SELECT * FROM campaigns WHERE id = ?`, [campaignId]);

export const latestReadyCampaign = (
  db: DatabaseSync,
  rootPath: string,
): CampaignRow | null =>
  one<CampaignRow>(
    db,
    `SELECT * FROM campaigns
      WHERE root_path = ? AND state = 'ready'
      ORDER BY id DESC
      LIMIT 1`,
    [rootPath],
  );

export const listCampaigns = (db: DatabaseSync): CampaignRow[] =>
  all<CampaignRow>(
    db,
    `SELECT * FROM campaigns WHERE state IN ('starting', 'ready', 'stopping') ORDER BY id DESC`,
  );

export const insertLane = (
  db: DatabaseSync,
  values: {
    campaignId: number;
    laneNo: number;
    worktreePath: string;
    cacheDir: string;
    configPath: string;
  },
): void => {
  run(
    db,
    `INSERT INTO campaign_lanes (campaign_id, lane_no, worktree_path, cache_dir, config_path)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (campaign_id, lane_no) DO UPDATE
       SET worktree_path = excluded.worktree_path,
           cache_dir = excluded.cache_dir,
           config_path = excluded.config_path,
           state = 'idle'`,
    [
      values.campaignId,
      values.laneNo,
      values.worktreePath,
      values.cacheDir,
      values.configPath,
    ],
  );
};

export const listLanes = (
  db: DatabaseSync,
  campaignId: number,
): CampaignLaneRow[] =>
  all<CampaignLaneRow>(
    db,
    `SELECT * FROM campaign_lanes WHERE campaign_id = ? ORDER BY lane_no`,
    [campaignId],
  );

export const setLaneState = (
  db: DatabaseSync,
  campaignId: number,
  laneNo: number,
  state: LaneState,
): void => {
  run(
    db,
    `UPDATE campaign_lanes SET state = ? WHERE campaign_id = ? AND lane_no = ?`,
    [state, campaignId, laneNo],
  );
};

export const countLaneRun = (
  db: DatabaseSync,
  campaignId: number,
  laneNo: number,
): void => {
  run(
    db,
    `UPDATE campaign_lanes SET mutants_run = mutants_run + 1 WHERE campaign_id = ? AND lane_no = ?`,
    [campaignId, laneNo],
  );
};

export const recordAttempt = (
  db: DatabaseSync,
  values: {
    campaignId: number | null;
    mutantId: number;
    laneNo: number;
    attempt: number;
    outcome: string;
    infrastructure: boolean;
    durationMs: number;
    reason: string;
  },
): void => {
  run(
    db,
    `INSERT INTO mutant_attempts
       (campaign_id, mutant_id, lane_no, attempt, outcome, infrastructure, duration_ms, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.campaignId,
      values.mutantId,
      values.laneNo,
      values.attempt,
      values.outcome,
      values.infrastructure ? 1 : 0,
      Math.round(values.durationMs),
      values.reason,
    ],
  );
};
