import type { MutantOutcome } from "test-forge-contracts/mutation";
import type {
  ChangedLines,
  Reconciliation,
  StrykerCounts,
  UnresolvedMutant,
} from "test-forge-contracts/stryker";

export type LedgerMutant = {
  mutantId: number;
  file: string;
  line: number;
  mutator: string;
  outcome: MutantOutcome;
};

const FINAL_OUTCOMES: ReadonlySet<MutantOutcome> = new Set([
  "killed",
  "killed_by_timeout",
  "survived",
  "no_coverage",
  "unviable",
  "equivalent-signed",
]);

export const changedLinesIn = (
  changed: ChangedLines,
  files: readonly string[],
): number =>
  files.reduce(
    (total, file) =>
      total +
      (changed[file] ?? []).reduce(
        (sum, [from, to]) => sum + (to - from + 1),
        0,
      ),
    0,
  );

export const reconcile = ({
  changed,
  files,
  inScopeStryker,
  inScopeExtra,
  ledger,
}: {
  changed: ChangedLines;
  files: readonly string[];
  inScopeStryker: number;
  inScopeExtra: number;
  ledger: readonly LedgerMutant[];
}): Reconciliation => {
  const scoped = ledger.filter((mutant) => mutant.outcome !== "out_of_scope");
  const finalStates: StrykerCounts = {};
  for (const mutant of scoped) {
    finalStates[mutant.outcome] = (finalStates[mutant.outcome] ?? 0) + 1;
  }
  const withoutFinalState: UnresolvedMutant[] = scoped
    .filter((mutant) => !FINAL_OUTCOMES.has(mutant.outcome))
    .map((mutant) => ({ ...mutant }));
  const inScopeExpected = inScopeStryker + inScopeExtra;
  return {
    changedFiles: files.filter((file) => (changed[file] ?? []).length > 0).length,
    changedLines: changedLinesIn(changed, files),
    inScopeStryker,
    inScopeExtra,
    inScopeExpected,
    inScopeInLedger: scoped.length,
    finalStates,
    withoutFinalState,
    consistent: withoutFinalState.length === 0 && scoped.length === inScopeExpected,
  };
};
