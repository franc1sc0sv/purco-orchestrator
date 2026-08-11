import { unresolvedSummary } from "../../domain/closure/resolution.ts";
import type { UnresolvedSummary } from "../../domain/closure/resolution.ts";
import { all, one, openDb } from "../../infrastructure/db/connection.ts";
import type { RadiusNodeRow } from "../../infrastructure/db/rows.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { resolve } from "node:path";

export type ClosureUnresolvedInput = {
  cwd: string;
  runId: number;
};

export type ClosureUnresolvedResult = UnresolvedSummary;

type NodeTotalRow = { total: number };

export const closureUnresolved = async ({
  cwd,
  runId,
}: ClosureUnresolvedInput): Promise<ClosureUnresolvedResult> => {
  const db = openDb();
  const projectKey = await projectKeyOf(resolve(cwd));
  const rows = all<
    Pick<RadiusNodeRow, "node_ref" | "node_kind" | "resolution">
  >(
    db,
    `SELECT node_ref, node_kind, resolution
       FROM radius_nodes
      WHERE project_key = ? AND run_id = ? AND resolution = 'unresolved'
      ORDER BY node_kind, node_ref`,
    [projectKey, runId]
  );
  const total = one<NodeTotalRow>(
    db,
    "SELECT COUNT(*) AS total FROM radius_nodes WHERE project_key = ? AND run_id = ?",
    [projectKey, runId]
  );
  return unresolvedSummary(
    rows.map((row) => ({
      nodeId: row.node_ref,
      kind: row.node_kind,
      state: row.resolution,
    })),
    total?.total ?? 0
  );
};
