import { coveringTestsOf } from "../../domain/stryker/extra-coverage.ts";
import type { CoveredSite } from "../../domain/stryker/extra-coverage.ts";
import { isSelected, siteKey } from "../../domain/stryker/scope.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import {
  recordStrykerMutants,
  strykerRowsOf,
} from "../../infrastructure/db/stryker-store.ts";
import type { StrykerMutantRecord } from "../../infrastructure/db/stryker-store.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { listExtraSites } from "../../infrastructure/stryker-extra-operators.ts";
import { resolveScope } from "./scope.ts";
import type { StrykerScopeInput } from "./scope.ts";
import { jobOf, runSoloJobs, summarizeSolo } from "./solo.ts";
import type { SoloInput } from "./solo.ts";
import { EXTRA_MUTATORS } from "test-forge-contracts/stryker";
import type {
  ExtraOperatorsResult,
  MutantSite,
} from "test-forge-contracts/stryker";

export type ExtraOperatorsInput = StrykerScopeInput &
  Pick<SoloInput, "projectConfigFile" | "dbSetupFile" | "lanes"> & {
    runId: number;
    touchedTestFiles?: readonly string[] | undefined;
  };

const EXTRA_MUTATOR_NAMES: ReadonlySet<string> = new Set(EXTRA_MUTATORS);

const spanKeyOf = (site: MutantSite): string =>
  siteKey({ ...site, mutator: "" });

const SETTLED_OUTCOMES: ReadonlySet<string> = new Set([
  "killed",
  "survived",
  "killed_by_timeout",
  "unviable",
]);

const touchesFile = (
  tests: readonly { file: string }[],
  touched: readonly string[],
): boolean =>
  tests.some((test) =>
    touched.some(
      (file) =>
        file === test.file ||
        file.endsWith(`/${test.file}`) ||
        test.file.endsWith(`/${file}`),
    ),
  );

export const extraOperators = async (
  input: ExtraOperatorsInput,
): Promise<ExtraOperatorsResult> => {
  const generateStartedAt = Date.now();
  const scope = await resolveScope(input);
  if (!scope.ok) return scope;
  const { root, changed, instrumented, selections, scopeRule } = scope;
  const db = openDb();
  const covered: CoveredSite[] = strykerRowsOf(db, input.runId)
    .filter((row) => !EXTRA_MUTATOR_NAMES.has(row.site.mutator))
    .map((row) => ({ site: row.site, coveredBy: row.coveredBy }));
  const files = selections.flatMap((selection) => selection.files);
  const strykerKeys = new Set(
    instrumented.flatMap((entry) => entry.sites.map(spanKeyOf)),
  );
  const records: StrykerMutantRecord[] = [];
  const byMutator: Record<string, number> = {};
  let duplicatesOfStryker = 0;
  let noCoverage = 0;
  for (const entry of listExtraSites(root, files)) {
    const ranges = changed[entry.file] ?? [];
    for (const { originalText, ...site } of entry.sites) {
      if (!isSelected(scopeRule, site, ranges)) continue;
      if (strykerKeys.has(spanKeyOf(site))) {
        duplicatesOfStryker += 1;
        continue;
      }
      const coveredBy = coveringTestsOf(site, covered);
      const uncovered = coveredBy.length === 0;
      if (uncovered) noCoverage += 1;
      byMutator[site.mutator] = (byMutator[site.mutator] ?? 0) + 1;
      records.push({
        site,
        originalText,
        outcome: uncovered ? "no_coverage" : "pending",
        strykerStatus: uncovered ? "NoCoverage" : "Pending",
        coveredBy,
        killedBy: [],
      });
    }
  }
  const settled = new Map(
    strykerRowsOf(db, input.runId)
      .filter(
        (row) =>
          EXTRA_MUTATOR_NAMES.has(row.site.mutator) &&
          SETTLED_OUTCOMES.has(row.outcome),
      )
      .map((row) => [siteKey(row.site), row] as const),
  );
  const touched = input.touchedTestFiles;
  const fresh =
    touched === undefined
      ? records
      : records.filter((record) => {
          const previous = settled.get(siteKey(record.site));
          return (
            previous === undefined ||
            touchesFile(previous.coveredBy, touched) ||
            touchesFile(record.coveredBy, touched)
          );
        });
  recordStrykerMutants(db, await projectKeyOf(root), input.runId, fresh);
  const generateMs = Date.now() - generateStartedAt;

  const runStartedAt = Date.now();
  const pending = strykerRowsOf(db, input.runId).filter(
    (row) => EXTRA_MUTATOR_NAMES.has(row.site.mutator) && row.outcome === "pending",
  );
  const batch = await runSoloJobs({ ...input, bail: true }, pending.map(jobOf));
  if (!batch.ok) return batch;
  return {
    ok: true,
    runId: input.runId,
    scopeRule,
    generated: records.length,
    duplicatesOfStryker,
    noCoverage,
    byMutator,
    generateMs,
    ...summarizeSolo(batch.results, batch.recoveredBackups, runStartedAt),
  };
};
