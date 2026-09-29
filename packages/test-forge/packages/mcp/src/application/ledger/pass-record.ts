import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import type { PassRow } from "../../infrastructure/db/rows.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { bit, normalisePredicates, PREDICATE_KEYS } from "./ledger-input.ts";
import type { DoneVector, PredicateKey } from "test-forge-contracts/gates";

export type PassRecordInput = {
  cwd: string;
  runId: number;
  predicates: Record<string, unknown>;
};

export type PassRecordResult = {
  projectKey: string;
  runId: number;
  passNo: number;
  predicates: DoneVector;
  failing: PredicateKey[];
  allGreen: boolean;
  stalled: boolean;
  previousPassNo: number | null;
};

export const passRecord = async ({
  cwd,
  runId,
  predicates,
}: PassRecordInput): Promise<PassRecordResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);
  const vector = normalisePredicates(predicates);

  return tx(db, (txScope) => {
    const previous = one<PassRow>(
      txScope.db,
      `SELECT * FROM passes WHERE run_id = ? ORDER BY pass_no DESC LIMIT 1`,
      [runId]
    );
    const passNo = (previous?.pass_no ?? 0) + 1;
    run(
      txScope.db,
      `INSERT INTO passes (run_id, pass_no, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        passNo,
        bit(vector.d1),
        bit(vector.d2),
        bit(vector.d3),
        bit(vector.d4),
        bit(vector.d5),
        bit(vector.d6),
        bit(vector.d7),
        bit(vector.d8),
        bit(vector.d9),
        bit(vector.d10),
      ]
    );

    return {
      projectKey,
      runId,
      passNo,
      predicates: vector,
      failing: PREDICATE_KEYS.filter((key) => !vector[key]),
      allGreen: PREDICATE_KEYS.every((key) => vector[key]),
      stalled:
        previous !== null &&
        PREDICATE_KEYS.every((key) => previous[key] === bit(vector[key])),
      previousPassNo: previous?.pass_no ?? null,
    };
  });
};
