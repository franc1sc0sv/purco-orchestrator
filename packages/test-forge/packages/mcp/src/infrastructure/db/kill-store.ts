import { run } from "./connection.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Kill } from "test-forge-contracts/mutation";

const CLEAR_KILLS_FOR_MUTANT = `DELETE FROM kills WHERE mutant_id = ?`;

const RECORD_KILL = `
INSERT INTO kills (mutant_id, test_name, file_path, attribution_complete)
VALUES (?, ?, ?, ?)
ON CONFLICT (mutant_id, test_name, file_path)
  DO UPDATE SET attribution_complete = excluded.attribution_complete`;

export const recordKills = ({
  db,
  mutantId,
  kills,
  attributionComplete,
}: {
  db: DatabaseSync;
  mutantId: number;
  kills: readonly Kill[];
  attributionComplete: boolean;
}): void => {
  run(db, CLEAR_KILLS_FOR_MUTANT, [mutantId]);
  for (const kill of kills) {
    run(db, RECORD_KILL, [mutantId, kill.name, kill.file, attributionComplete]);
  }
};
