import {
  readFixtures,
  readLatestVersionNumber,
  toStoredLabel,
} from "../../infrastructure/db/codex-store.ts";
import { one, openDb, run } from "../../infrastructure/db/connection.ts";
import {
  hashFile,
  projectRelative,
  readableFile,
} from "../../infrastructure/files.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { FixtureLabel } from "test-forge-contracts/codex";

export type FixtureAddInput = {
  cwd: string;
  ruleId: string;
  filePath: string;
  label: string;
  isNearMiss?: boolean | undefined;
  why: string;
  labelledBy: string;
};

export type FixtureAddResult = {
  projectKey: string;
  ruleId: string;
  ruleFound: boolean;
  ruleVersion: number | null;
  path: string;
  label: FixtureLabel;
  isNearMiss: boolean;
  pinnedHash: string;
  currentHash: string;
  added: boolean;
  alreadyPresent: boolean;
  hashDrifted: boolean;
  total: number;
  nearMissCount: number;
};

export const fixtureAdd = async ({
  cwd,
  ruleId,
  filePath,
  label,
  isNearMiss = false,
  why,
  labelledBy,
}: FixtureAddInput): Promise<FixtureAddResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const storedLabel = toStoredLabel(label);
  if (why.trim().length === 0) {
    throw new Error(
      "A fixture requires a why: the reason this file carries this label"
    );
  }
  if (labelledBy.trim().length === 0) {
    throw new Error("A fixture requires labelledBy");
  }
  const absolute = readableFile(cwd, filePath);
  const hash = absolute === null ? null : hashFile(absolute);
  if (hash === null) {
    throw new Error(
      `No readable file at "${filePath}", so no hash can pin this fixture`
    );
  }
  const recordedPath = projectRelative(cwd, filePath);
  const nearMiss = isNearMiss ? 1 : 0;

  const existing = one<{ id: number; file_hash: string }>(
    db,
    `SELECT id, file_hash FROM fixtures
      WHERE project_key = ? AND rule_id = ? AND file_path = ? AND label = ? AND is_near_miss = ?`,
    [projectKey, ruleId, recordedPath, storedLabel, nearMiss]
  );

  const ruleVersion = readLatestVersionNumber(db, projectKey, ruleId);

  if (existing === null) {
    run(
      db,
      `INSERT INTO fixtures (project_key, rule_id, file_path, file_hash, label, is_near_miss, why, labelled_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectKey,
        ruleId,
        recordedPath,
        hash,
        storedLabel,
        nearMiss,
        why,
        labelledBy,
      ]
    );
  }

  const fixtures = readFixtures(db, projectKey, ruleId);
  return {
    projectKey,
    ruleId,
    ruleFound: ruleVersion !== null,
    ruleVersion,
    path: recordedPath,
    label: storedLabel,
    isNearMiss: nearMiss === 1,
    pinnedHash: existing === null ? hash : existing.file_hash,
    currentHash: hash,
    added: existing === null,
    alreadyPresent: existing !== null,
    hashDrifted: existing !== null && existing.file_hash !== hash,
    total: fixtures.length,
    nearMissCount: fixtures.filter((fixture) => fixture.isNearMiss === true)
      .length,
  };
};
