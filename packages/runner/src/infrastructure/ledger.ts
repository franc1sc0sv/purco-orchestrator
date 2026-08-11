import {
  one,
  openDb,
} from "test-forge-mcp-server/src/infrastructure/db/connection.ts";

export const latestOpenRun = (projectKey: string): number | null => {
  const row = one<{ id: number }>(
    openDb(),
    `SELECT id FROM runs WHERE project_key = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`,
    [projectKey]
  );
  return row === null ? null : row.id;
};
