import { detectFamily } from "../../domain/execution/command.ts";
import { parseReport } from "../../domain/execution/report.ts";
import { mutantViability } from "../../domain/mutation/syntax.ts";
import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { recordKills } from "../../infrastructure/db/kill-store.ts";
import type { MutantRow } from "../../infrastructure/db/rows.ts";
import { repoRoot } from "../../infrastructure/git.ts";
import {
  DEFAULT_TIMEOUT_MS,
  runProcess,
} from "../../infrastructure/process.ts";
import {
  discardWorktree,
  prepareWorktree,
  swapLine,
  toRepoRelative,
} from "../../infrastructure/worktree.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedRun } from "test-forge-contracts/execution";
import type { Kill } from "test-forge-contracts/mutation";

export type MutationApplyAndRunInput = {
  cwd: string;
  mutantId: number;
  tests: readonly string[];
  command?: string | undefined;
  timeoutMs?: number | undefined;
  bail?: boolean | undefined;
};

export type MutationRunOutcome =
  | "killed"
  | "survived"
  | "timeout"
  | "error"
  | "unviable";

export type MutationRunDetail = {
  command?: string;
  reason?: string;
  exitCode?: number | null;
  stderr?: string;
  expected?: string;
  found?: string | null;
  warnings?: string[];
};

export type MutationApplyAndRunResult =
  | ({
      ok: true;
      mutantId: number;
      outcome: MutationRunOutcome;
      killedBy: Kill[];
    } & MutationRunDetail)
  | { ok: false; outcome: "error"; reason: string };

const MAX_STDERR_CHARACTERS = 4000;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const mutationApplyAndRun = async ({
  cwd,
  mutantId,
  tests,
  command,
  timeoutMs,
  bail = false,
}: MutationApplyAndRunInput): Promise<MutationApplyAndRunResult> => {
  const root = await repoRoot(cwd);
  const db = openDb();
  const mutant = one<
    Pick<
      MutantRow,
      "id" | "file_path" | "line" | "operator" | "before_text" | "after_text"
    >
  >(
    db,
    "SELECT id, file_path, line, operator, before_text, after_text FROM mutants WHERE id = ?",
    [mutantId]
  );
  if (mutant === null) {
    return {
      ok: false,
      outcome: "error",
      reason: `no mutant with id ${mutantId}`,
    };
  }

  const worktree = join(
    tmpdir(),
    `test-forge-mutant-${mutantId}-${process.pid}-${Date.now()}`
  );
  const patchFile = `${worktree}.patch`;
  const warnings: string[] = [];

  const record = (
    outcome: MutationRunOutcome,
    kills: readonly Kill[],
    detail: MutationRunDetail
  ): MutationApplyAndRunResult => {
    tx(db, (txScope) => {
      run(txScope.db, "UPDATE mutants SET outcome = ? WHERE id = ?", [
        outcome,
        mutantId,
      ]);
      recordKills({
        db: txScope.db,
        mutantId,
        kills,
        attributionComplete: !bail,
      });
    });
    return {
      ok: true,
      mutantId,
      outcome,
      killedBy: [...kills],
      ...detail,
      ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
    };
  };

  const viability = mutantViability(mutant.before_text, mutant.after_text);
  if (!viability.viable) {
    return record("unviable", [], { reason: viability.reason });
  }

  const prepared = await prepareWorktree(root, worktree);
  warnings.push(...prepared.warnings);
  if (!prepared.ok) {
    await discardWorktree(root, worktree, patchFile);
    return record("error", [], { reason: prepared.reason });
  }

  try {
    const applied = swapLine(
      join(worktree, mutant.file_path),
      mutant.line,
      mutant.before_text,
      mutant.after_text
    );
    if (!applied.ok) {
      return record("error", [], {
        reason: applied.reason,
        expected: applied.expected,
        found: applied.found,
      });
    }

    const testArguments = tests.map((test) => toRepoRelative(root, test));
    const bailArgument = bail ? " --bail=1" : "";
    const runCommand =
      command ??
      `npx vitest run --reporter=json${bailArgument} ${testArguments.join(
        " "
      )}`;
    const execution = await runProcess({
      command: runCommand,
      cwd: worktree,
      shell: true,
      timeoutMs,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    });

    if (execution.timedOut)
      return record("timeout", [], { command: runCommand });

    let report: ParsedRun;
    try {
      report = parseReport(detectFamily(runCommand), execution.stdout);
    } catch (error) {
      const truncation = execution.stdoutTruncated
        ? " after the output passed the capture limit and was truncated"
        : "";
      return record("error", [], {
        command: runCommand,
        reason: `test runner report could not be read${truncation}: ${messageOf(
          error
        )}`,
        exitCode: execution.code,
        stderr: execution.stderr.slice(-MAX_STDERR_CHARACTERS),
      });
    }

    const failures = report.failures.map((failure) => ({
      file: toRepoRelative(worktree, failure.file),
      name: failure.testName,
    }));
    if (failures.length > 0)
      return record("killed", failures, { command: runCommand });
    if (execution.code !== 0) {
      return record("error", [], {
        command: runCommand,
        reason: "runner exited non-zero with no failing test",
        exitCode: execution.code,
      });
    }
    return record("survived", [], { command: runCommand });
  } finally {
    await discardWorktree(root, worktree, patchFile);
  }
};
