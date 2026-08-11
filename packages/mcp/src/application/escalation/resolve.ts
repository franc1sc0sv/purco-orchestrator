import { closureOf, requireText } from "../../domain/escalation/escalation.ts";
import {
  nowIso,
  one,
  openDb,
  run,
  tx,
} from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import type { EscalationRow } from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { EscalationClosure } from "test-forge-contracts/escalation";

export type EscalationResolveInput = {
  cwd: string;
  runId: number;
  escalationKey: string;
  resolution: string;
  resolvedBy: string;
  reason: string;
};

export type EscalationResolveResult = {
  projectKey: string;
  runId: number;
  escalationId: number;
  escalationKey: string;
  closure: EscalationClosure;
  openCount: number;
  d10: boolean;
};

type CountRow = { total: number };

export const escalationResolve = async ({
  cwd,
  runId,
  escalationKey,
  resolution,
  resolvedBy,
  reason,
}: EscalationResolveInput): Promise<EscalationResolveResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);

  const key = requireText(escalationKey, "escalationKey");
  const closure = closureOf({
    resolution,
    resolvedBy,
    reason,
    resolvedAt: nowIso(),
  });

  const row = tx(db, (txScope) => {
    const stored = one<EscalationRow>(
      txScope.db,
      "SELECT * FROM escalations WHERE run_id = ? AND escalation_key = ?",
      [runId, key]
    );
    if (stored === null) {
      throw new Error(
        `No escalation ${key} is recorded on run ${runId}, so there is nothing to resolve`
      );
    }
    if (stored.state === "resolved") {
      throw new Error(
        `Escalation ${key} was already resolved as ${stored.resolution} by ${stored.resolved_by}`
      );
    }
    run(
      txScope.db,
      `UPDATE escalations
          SET state = 'resolved', resolution = ?, resolved_by = ?, resolved_reason = ?, resolved_at = ?
        WHERE id = ? AND state = 'open'`,
      [
        closure.resolution,
        closure.resolvedBy,
        closure.reason,
        closure.resolvedAt,
        stored.id,
      ]
    );
    return stored;
  });

  const open =
    one<CountRow>(
      db,
      "SELECT COUNT(*) AS total FROM escalations WHERE project_key = ? AND run_id = ? AND state = 'open'",
      [projectKey, runId]
    )?.total ?? 0;

  return {
    projectKey,
    runId,
    escalationId: row.id,
    escalationKey: row.escalation_key,
    closure,
    openCount: open,
    d10: open === 0,
  };
};
