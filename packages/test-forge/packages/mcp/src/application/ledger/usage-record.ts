import { all, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import { resolveProject } from "../../infrastructure/project.ts";

export type UsageRow = {
  callsign: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

export type UsageRecordInput = {
  cwd: string;
  runId: number;
  cycle: number;
  rows: readonly UsageRow[];
};

export type UsageTotal = UsageRow & { cycles: number };

export const usageRecord = async ({
  cwd,
  runId,
  cycle,
  rows,
}: UsageRecordInput): Promise<number> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);
  tx(db, (txScope) => {
    for (const row of rows) {
      run(
        txScope.db,
        `INSERT INTO usage_records
           (project_key, run_id, cycle, callsign, model, input_tokens, output_tokens,
            cache_read_tokens, cache_write_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          projectKey,
          runId,
          cycle,
          row.callsign,
          row.model,
          row.inputTokens,
          row.outputTokens,
          row.cacheReadTokens,
          row.cacheWriteTokens,
          row.costUsd,
        ],
      );
    }
  });
  return rows.length;
};

export const usageByModel = (runId: number): Map<string, number> => {
  const rows = all<{ model: string; cost: number }>(
    openDb(),
    `SELECT model, SUM(cost_usd) AS cost FROM usage_records WHERE run_id = ? GROUP BY model`,
    [runId],
  );
  return new Map(rows.map((row) => [row.model, row.cost]));
};

export const usageByPost = (runId: number): UsageTotal[] =>
  all<{
    callsign: string;
    model: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    cycles: number;
  }>(
    openDb(),
    `SELECT callsign, model,
            SUM(input_tokens) AS input, SUM(output_tokens) AS output,
            SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite,
            SUM(cost_usd) AS cost, COUNT(DISTINCT cycle) AS cycles
       FROM usage_records
      WHERE run_id = ?
      GROUP BY callsign, model
      ORDER BY cost DESC`,
    [runId],
  ).map((row) => ({
    callsign: row.callsign,
    model: row.model,
    inputTokens: row.input,
    outputTokens: row.output,
    cacheReadTokens: row.cacheRead,
    cacheWriteTokens: row.cacheWrite,
    costUsd: row.cost,
    cycles: row.cycles,
  }));
