import { reconcile } from "../../domain/stryker/reconciliation.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import {
  recordSoloOutcome,
  soloSettledRowsOf,
  strykerRowsOf,
} from "../../infrastructure/db/stryker-store.ts";
import { EXTRA_MUTATORS } from "test-forge-contracts/stryker";
import { recoverBackups } from "../../infrastructure/solo-backup.ts";
import { removeSoloLanes, soloLanePoolOf } from "../../infrastructure/solo-lanes.ts";
import { harnessStart, harnessStop } from "./harness.ts";
import type { HarnessStartInput } from "./harness.ts";
import { extraOperators } from "./extra-operators.ts";
import { strykerRun } from "./run.ts";
import type { StrykerRunInput } from "./run.ts";
import { resolveScope } from "./scope.ts";
import { timeoutRecheck } from "./solo.ts";
import { repoRoot } from "../../infrastructure/git.ts";
import type {
  MutationPassResult,
  MutationPassStage,
  ProjectKind,
} from "test-forge-contracts/stryker";

export type MutationPassInput = StrykerRunInput & {
  runId: number;
  touchedTestFiles?: readonly string[] | undefined;
  harness?: Omit<HarnessStartInput, "cwd" | "concurrency" | "projectConfigFile"> | undefined;
};

const EXTRA_MUTATOR_NAMES: ReadonlySet<string> = new Set(EXTRA_MUTATORS);

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

export const mutationPass = async (
  input: MutationPassInput,
): Promise<MutationPassResult> => {
  const startedAt = Date.now();
  const stages: MutationPassStage[] = [];
  const timed = async <TResult>(
    stage: string,
    work: () => Promise<TResult>,
  ): Promise<TResult> => {
    const stageStartedAt = Date.now();
    try {
      return await work();
    } finally {
      stages.push({ stage, ms: Date.now() - stageStartedAt });
    }
  };
  const fail = (reason: string): MutationPassResult => ({
    ok: false,
    reason,
    stages,
  });

  const root = await repoRoot(input.cwd);
  recoverBackups(root);
  removeSoloLanes(root);
  const lanes = soloLanePoolOf(root);
  const scope = await timed("scope", () => resolveScope(input));
  if (!scope.ok) return fail(scope.reason);
  const needsHarness = scope.selections.some(
    (selection) => selection.kind === "backend" && selection.inScope.length > 0,
  );

  let harnessStarted = false;
  if (needsHarness) {
    const started = await timed("harnessStart", () =>
      harnessStart({
        ...input.harness,
        cwd: root,
        concurrency: input.concurrency,
        projectConfigFile: input.projectConfigFile,
      }),
    );
    if (!started.ok) return fail(`harness: ${started.reason}`);
    harnessStarted = !started.reused;
  }

  const runStages = async (): Promise<MutationPassResult> => {
    const settledBefore =
      input.touchedTestFiles === undefined
        ? []
        : soloSettledRowsOf(openDb(), input.runId).filter(
            (row) =>
              !EXTRA_MUTATOR_NAMES.has(row.mutator) &&
              !touchesFile(row.coveredBy, input.touchedTestFiles ?? []),
          );
    const stryker = await timed("stryker", () => strykerRun({ ...input, cwd: root }));
    if (!stryker.ok) return fail(`stryker: ${stryker.reason}`);
    if (settledBefore.length > 0) {
      const current = new Map(
        strykerRowsOf(openDb(), input.runId).map((row) => [row.id, row] as const),
      );
      for (const row of settledBefore) {
        const now = current.get(row.id);
        if (
          now !== undefined &&
          now.outcome === "timeout_pending" &&
          !touchesFile(now.coveredBy, input.touchedTestFiles ?? [])
        ) {
          recordSoloOutcome(
            openDb(),
            row.id,
            row.outcome,
            row.strykerStatus,
            row.killedBy,
          );
        }
      }
    }
    const extras = await timed("extraOperators", () =>
      extraOperators({ ...input, cwd: root, lanes }),
    );
    if (!extras.ok) return fail(`extra operators: ${extras.reason}`);
    const recheck = await timed("timeoutRecheck", () =>
      timeoutRecheck({ ...input, cwd: root, lanes }),
    );
    if (!recheck.ok) return fail(`timeout re-check: ${recheck.reason}`);
    const ledger = strykerRowsOf(openDb(), input.runId).map((row) => ({
      mutantId: row.id,
      file: row.site.file,
      line: row.site.start.line,
      mutator: row.site.mutator,
      outcome: row.outcome,
    }));
    const reconciliation = reconcile({
      changed: scope.changed,
      files: scope.selections.flatMap((selection) => selection.files),
      inScopeStryker: stryker.inScope,
      inScopeExtra: ledger.filter(
        (mutant) =>
          EXTRA_MUTATOR_NAMES.has(mutant.mutator) &&
          mutant.outcome !== "out_of_scope",
      ).length,
      ledger,
    });
    const testFiles: Record<ProjectKind, string[]> = {
      backend: [],
      frontend: [],
    };
    for (const selection of scope.selections) {
      testFiles[selection.kind] = selection.testFiles;
    }
    return {
      ok: true,
      runId: input.runId,
      scopeRule: scope.scopeRule,
      harnessStarted,
      harnessStopped: null,
      testFiles,
      counts: reconciliation.finalStates,
      stryker,
      extras,
      timeoutRecheck: recheck,
      reconciliation,
      stages,
      totalMs: 0,
    };
  };

  const result = await runStages()
    .catch((error: unknown) =>
      fail(error instanceof Error ? error.message : String(error)),
    )
    .finally(() => lanes.dispose());
  const stopped = harnessStarted
    ? await timed("harnessStop", () => harnessStop({ cwd: root }))
    : null;
  if (!result.ok) return result;
  return {
    ...result,
    harnessStopped: stopped === null ? null : stopped.ok,
    totalMs: Date.now() - startedAt,
  };
};
