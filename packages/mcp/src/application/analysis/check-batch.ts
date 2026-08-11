import { failureOf } from "../../domain/batch/failure.ts";
import type { BatchFailure } from "../../domain/batch/failure.ts";
import { astCheck } from "./check.ts";
import type { CheckInput } from "./check.ts";
import type { FileCheckReport } from "test-forge-contracts/analysis";

export type AstCheckBatchOptions = {
  cwd: string;
  filePaths: readonly string[];
  checks: readonly CheckInput[];
};

export type CheckTally = {
  checkId: string;
  appliedFiles: number;
  violatedFiles: number;
  erroredFiles: number;
};

export type AstCheckBatchResult = {
  requested: number;
  readCount: number;
  failedCount: number;
  filesWithViolation: number;
  byCheck: CheckTally[];
  reports: FileCheckReport[];
  violations: FileCheckReport[];
  failures: BatchFailure[];
};

const tally = (reports: readonly FileCheckReport[]): CheckTally[] => {
  const tallies = new Map<string, CheckTally>();
  for (const report of reports) {
    for (const outcome of report.checks) {
      const current = tallies.get(outcome.checkId) ?? {
        checkId: outcome.checkId,
        appliedFiles: 0,
        violatedFiles: 0,
        erroredFiles: 0,
      };
      tallies.set(outcome.checkId, {
        checkId: outcome.checkId,
        appliedFiles: current.appliedFiles + (outcome.applied ? 1 : 0),
        violatedFiles: current.violatedFiles + (outcome.violated ? 1 : 0),
        erroredFiles: current.erroredFiles + (outcome.error === null ? 0 : 1),
      });
    }
  }
  return [...tallies.values()];
};

export const astCheckBatch = ({
  cwd,
  filePaths,
  checks,
}: AstCheckBatchOptions): AstCheckBatchResult => {
  const reports: FileCheckReport[] = [];
  const failures: BatchFailure[] = [];
  for (const filePath of filePaths) {
    try {
      reports.push(astCheck({ cwd, filePath, checks }));
    } catch (error) {
      failures.push(failureOf(filePath, error));
    }
  }
  const violations = reports.filter((report) => report.violatedCount > 0);
  return {
    requested: filePaths.length,
    readCount: reports.length,
    failedCount: failures.length,
    filesWithViolation: violations.length,
    byCheck: tally(reports),
    reports,
    violations,
    failures,
  };
};
