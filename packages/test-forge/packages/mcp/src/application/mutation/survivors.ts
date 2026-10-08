import { d5Holds } from "../../domain/mutation/attribution.ts";
import { all, one, openDb } from "../../infrastructure/db/connection.ts";
import { repoRoot } from "../../infrastructure/git.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import type {
  MutantRow,
  PendingMutantRow,
} from "test-forge-contracts/mutation";

export type MutationSurvivorsInput = {
  cwd: string;
  runId: number;
};

export type MutationSurvivorsResult = {
  survivors: MutantRow[];
  survivorCount: number;
  unrun: PendingMutantRow[];
  unrunCount: number;
  unviable: PendingMutantRow[];
  unviableCount: number;
  signedEquivalents: number;
  d5: boolean;
};

type SignedCountRow = { total: number };

export const mutationSurvivors = async ({
  cwd,
  runId,
}: MutationSurvivorsInput): Promise<MutationSurvivorsResult> => {
  const db = openDb();
  const projectKey = await projectKeyOf(await repoRoot(cwd));
  const survivors = all<MutantRow>(
    db,
    `SELECT m.id, m.file_path, m.line, m.operator, m.before_text, m.after_text, m.outcome
       FROM mutants m
      WHERE m.project_key = ? AND m.run_id = ?
        AND m.outcome IN ('survived', 'no_coverage', 'equivalent-claimed', 'refuted')
        AND NOT EXISTS (
          SELECT 1 FROM equivalence_claims e
           WHERE e.mutant_id = m.id AND e.upheld = 1 AND e.signed_by IS NOT NULL
        )
      ORDER BY m.file_path, m.line`,
    [projectKey, runId],
  );
  const unrun = all<PendingMutantRow>(
    db,
    `SELECT id, file_path, line, operator
       FROM mutants
      WHERE project_key = ? AND run_id = ?
        AND outcome IN ('pending', 'error', 'timeout', 'timeout_pending')
      ORDER BY file_path, line`,
    [projectKey, runId],
  );
  const unviable = all<PendingMutantRow>(
    db,
    `SELECT id, file_path, line, operator
       FROM mutants
      WHERE project_key = ? AND run_id = ? AND outcome = 'unviable'
      ORDER BY file_path, line`,
    [projectKey, runId],
  );
  const signed = one<SignedCountRow>(
    db,
    "SELECT COUNT(*) AS total FROM mutants WHERE project_key = ? AND run_id = ? AND outcome = 'equivalent-signed'",
    [projectKey, runId],
  );
  return {
    survivors,
    survivorCount: survivors.length,
    unrun,
    unrunCount: unrun.length,
    unviable,
    unviableCount: unviable.length,
    signedEquivalents: signed?.total ?? 0,
    d5: d5Holds(survivors.length, unrun.length),
  };
};
