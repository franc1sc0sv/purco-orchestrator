import { attributeKills } from "../../domain/mutation/attribution.ts";
import type { AttributionSummary } from "../../domain/mutation/attribution.ts";
import { all, openDb } from "../../infrastructure/db/connection.ts";
import type { KillRow } from "../../infrastructure/db/rows.ts";
import { repoRoot } from "../../infrastructure/git.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";

export type MutationAttributionInput = {
  cwd: string;
  runId: number;
  tests?: readonly string[] | undefined;
};

export type MutationAttributionResult = AttributionSummary;

export const mutationAttribution = async ({
  cwd,
  runId,
  tests,
}: MutationAttributionInput): Promise<MutationAttributionResult> => {
  const db = openDb();
  const projectKey = await projectKeyOf(await repoRoot(cwd));
  const rows = all<
    Pick<
      KillRow,
      "mutant_id" | "test_name" | "file_path" | "attribution_complete"
    >
  >(
    db,
    `SELECT k.mutant_id, k.test_name, k.file_path, k.attribution_complete
       FROM kills k JOIN mutants m ON m.id = k.mutant_id
      WHERE m.project_key = ? AND m.run_id = ?`,
    [projectKey, runId]
  );
  return attributeKills(
    rows.map((row) => ({
      mutantId: row.mutant_id,
      testFile: row.file_path,
      testName: row.test_name,
      attributionComplete: row.attribution_complete === 1,
    })),
    tests ?? []
  );
};
