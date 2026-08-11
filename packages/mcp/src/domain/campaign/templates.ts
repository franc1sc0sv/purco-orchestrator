export const DEFAULT_CONCURRENCY = 6;

export const MAX_CONCURRENCY = 6;

export const DEFAULT_SEED_DB_NAME = "seed_db";

export const DEFAULT_DB_SETUP_FILE =
  "tests/integration/setups/setup-db-per-test.ts";

const whole = (value: number | undefined, fallback: number): number => {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

export const boundedConcurrency = (value: number | undefined): number =>
  Math.min(whole(value, DEFAULT_CONCURRENCY), MAX_CONCURRENCY);

export const boundedLaneWorkers = (
  value: number | undefined,
  lanes: number
): number =>
  Math.min(whole(value, 1), Math.max(1, Math.floor(MAX_CONCURRENCY / lanes)));

export const seedTemplateNames = (
  seedDbName: string,
  count: number
): string[] =>
  Array.from(
    { length: whole(count, 0) },
    (_unused, index) => `${seedDbName}_${index + 1}`
  );

export const laneTemplateNames = ({
  all,
  laneNo,
  laneWorkers,
}: {
  all: readonly string[];
  laneNo: number;
  laneWorkers: number;
}): string[] => all.slice((laneNo - 1) * laneWorkers, laneNo * laneWorkers);
