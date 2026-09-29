import {
  composeCommand,
  detectFamily,
  MAX_DIAGNOSTIC_CHARS,
  reporterPlumbing,
  tail,
} from "../../domain/execution/command.ts";
import { parseReport } from "../../domain/execution/report.ts";
import {
  DEFAULT_SUITE_TIMEOUT_MS,
  runProcess,
} from "../../infrastructure/process.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ParsedRun,
  ReportSource,
  RunnerFamily,
  SeparatorMode,
  SuiteRun,
} from "test-forge-contracts/execution";

export type ExecSuiteOptions = {
  cwd: string;
  command: string;
  files?: readonly string[];
  family?: RunnerFamily;
  timeoutMs?: number;
  extraArgs?: readonly string[];
  separatorMode?: SeparatorMode;
  env?: Readonly<Record<string, string>>;
};

type ParseAttempt = {
  parsed: ParsedRun | null;
  source: ReportSource | null;
  reason: string;
};

const NEUTRAL_ENVIRONMENT: Readonly<Record<string, string>> = {
  CI: "1",
  FORCE_COLOR: "0",
  NO_COLOR: "1",
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const attemptParse = (
  family: RunnerFamily,
  reportPath: string,
  stdout: string
): ParseAttempt => {
  const attempts: string[] = [];
  try {
    const fileText = readFileSync(reportPath, "utf8");
    if (fileText.trim().length > 0) {
      return {
        parsed: parseReport(family, fileText),
        source: "report-file",
        reason: "",
      };
    }
    attempts.push("report file was empty");
  } catch (error) {
    attempts.push(`report file unreadable: ${messageOf(error)}`);
  }
  try {
    return {
      parsed: parseReport(family, stdout),
      source: "stdout",
      reason: "",
    };
  } catch (error) {
    attempts.push(`stdout unparseable: ${messageOf(error)}`);
  }
  return { parsed: null, source: null, reason: attempts.join("; ") };
};

export const execSuite = async ({
  cwd,
  command,
  files = [],
  family: forcedFamily,
  timeoutMs,
  extraArgs = [],
  separatorMode = "auto",
  env = {},
}: ExecSuiteOptions): Promise<SuiteRun> => {
  const family = forcedFamily ?? detectFamily(command);
  const directory = mkdtempSync(join(tmpdir(), "test-forge-run-"));
  const reportPath = join(directory, "report.json");
  const plumbing = reporterPlumbing(family, reportPath);
  const fullCommand = composeCommand(
    command,
    [...plumbing.args, ...extraArgs, ...files],
    separatorMode
  );

  try {
    const execution = await runProcess({
      cwd,
      command: fullCommand,
      shell: true,
      defaultTimeoutMs: DEFAULT_SUITE_TIMEOUT_MS,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      env: { ...NEUTRAL_ENVIRONMENT, ...plumbing.env, ...env },
    });
    const attempt = attemptParse(family, reportPath, execution.stdout);
    const diagnostic = `${execution.stderr}\n${execution.stdout}`;

    if (attempt.parsed === null) {
      return {
        command: fullCommand,
        family,
        files: [...files],
        exitCode: execution.code,
        signal: execution.signal,
        timedOut: execution.timedOut,
        reportParsed: false,
        reportSource: null,
        reportError: execution.timedOut
          ? `run exceeded ${execution.timeoutMs}ms and was killed; ${attempt.reason}`
          : attempt.reason,
        exitCodeUnexplained: execution.code !== 0,
        passed: null,
        failed: null,
        skipped: null,
        failures: [],
        tests: [],
        durationMs: execution.durationMs,
        diagnosticTail: tail(diagnostic, MAX_DIAGNOSTIC_CHARS),
      };
    }

    const unexplained = execution.code !== 0 && attempt.parsed.failed === 0;

    return {
      command: fullCommand,
      family,
      files: [...files],
      exitCode: execution.code,
      signal: execution.signal,
      timedOut: execution.timedOut,
      reportParsed: true,
      reportSource: attempt.source,
      reportError: null,
      exitCodeUnexplained: unexplained,
      passed: attempt.parsed.passed,
      failed: attempt.parsed.failed,
      skipped: attempt.parsed.skipped,
      failures: attempt.parsed.failures,
      tests: attempt.parsed.tests,
      durationMs: attempt.parsed.durationMs ?? execution.durationMs,
      diagnosticTail: unexplained
        ? tail(diagnostic, MAX_DIAGNOSTIC_CHARS)
        : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
