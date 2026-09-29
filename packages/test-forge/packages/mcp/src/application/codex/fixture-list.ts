import { readFixtures } from "../../infrastructure/db/codex-store.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import { hashFile, readableFile } from "../../infrastructure/files.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { Fixture } from "test-forge-contracts/codex";

export type FixtureListInput = {
  cwd: string;
  ruleId: string;
};

export type InspectedFixture = Fixture & {
  missing: boolean;
  currentHash: string | null;
  drifted: boolean;
};

export type FixtureListResult = {
  projectKey: string;
  ruleId: string;
  fixtures: InspectedFixture[];
  summary: {
    total: number;
    byLabel: Record<string, number>;
    nearMissCount: number;
    probedAtBoundary: boolean;
    driftedCount: number;
    missingCount: number;
  };
};

export const fixtureList = async ({
  cwd,
  ruleId,
}: FixtureListInput): Promise<FixtureListResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const fixtures = readFixtures(db, projectKey, ruleId).map((fixture) => {
    const absolute = readableFile(cwd, fixture.path);
    const currentHash = absolute === null ? null : hashFile(absolute);
    const pinned = fixture.hash ?? "";
    return {
      ...fixture,
      missing: absolute === null,
      currentHash,
      drifted: absolute !== null && pinned.length > 0 && pinned !== currentHash,
    };
  });

  const byLabel: Record<string, number> = {};
  for (const fixture of fixtures) {
    byLabel[fixture.label] = (byLabel[fixture.label] ?? 0) + 1;
  }
  const nearMissCount = fixtures.filter(
    (fixture) => fixture.isNearMiss === true
  ).length;

  return {
    projectKey,
    ruleId,
    fixtures,
    summary: {
      total: fixtures.length,
      byLabel,
      nearMissCount,
      probedAtBoundary: nearMissCount > 0,
      driftedCount: fixtures.filter((fixture) => fixture.drifted).length,
      missingCount: fixtures.filter((fixture) => fixture.missing).length,
    },
  };
};
