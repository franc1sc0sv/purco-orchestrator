import {
  composeCommand,
  MAX_DIAGNOSTIC_CHARS,
  tail,
} from "../../domain/execution/command.ts";
import {
  parseEslintJson,
  parseStylish,
  parseTypecheckProblems,
  summarise,
} from "../../domain/execution/problems.ts";
import {
  DEFAULT_SUITE_TIMEOUT_MS,
  runProcess,
} from "../../infrastructure/process.ts";
import type {
  LintFormat,
  LintReport,
  Problem,
  StaticCommandReport,
  StaticGateReport,
} from "test-forge-contracts/execution";

export type GateStaticOptions = {
  cwd: string;
  typecheckCommand?: string;
  lintCommand?: string;
  timeoutMs?: number;
  lintFormat?: LintFormat;
};

const ESLINT_INVOCATION = /(^|[\s/])eslint(\s|$)/;

const ESLINT_FORMAT_FLAG = /(--format|\s-f[\s=])/;

const diagnosticOf = (
  exitCode: number | null,
  problems: readonly Problem[],
  stderr: string,
  stdout: string,
): string | null =>
  exitCode !== 0 && problems.length === 0
    ? tail(`${stderr}\n${stdout}`, MAX_DIAGNOSTIC_CHARS)
    : null;

const runTypecheck = async (
  cwd: string,
  command: string,
  timeoutMs: number | undefined,
): Promise<StaticCommandReport> => {
  const execution = await runProcess({
    cwd,
    command,
    shell: true,
    defaultTimeoutMs: DEFAULT_SUITE_TIMEOUT_MS,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const problems = parseTypecheckProblems(
    `${execution.stdout}\n${execution.stderr}`,
  );
  return {
    command,
    exitCode: execution.code,
    timedOut: execution.timedOut,
    durationMs: execution.durationMs,
    parsed: problems.length > 0 || execution.code === 0,
    ...summarise(problems),
    diagnosticTail: diagnosticOf(
      execution.code,
      problems,
      execution.stderr,
      execution.stdout,
    ),
  };
};

const runLint = async (
  cwd: string,
  command: string,
  timeoutMs: number | undefined,
  format: LintFormat,
): Promise<LintReport> => {
  const invokesEslintDirectly =
    ESLINT_INVOCATION.test(command) && !ESLINT_FORMAT_FLAG.test(command);
  const fullCommand =
    format !== "text" && invokesEslintDirectly
      ? composeCommand(command, ["--format", "json"])
      : command;
  const execution = await runProcess({
    cwd,
    command: fullCommand,
    shell: true,
    defaultTimeoutMs: DEFAULT_SUITE_TIMEOUT_MS,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const jsonProblems =
    format === "text" ? null : parseEslintJson(execution.stdout);
  const problems =
    jsonProblems ?? parseStylish(`${execution.stdout}\n${execution.stderr}`);
  return {
    command: fullCommand,
    exitCode: execution.code,
    timedOut: execution.timedOut,
    durationMs: execution.durationMs,
    parsed:
      jsonProblems !== null || problems.length > 0 || execution.code === 0,
    format: jsonProblems !== null ? "json" : "text",
    ...summarise(problems),
    diagnosticTail: diagnosticOf(
      execution.code,
      problems,
      execution.stderr,
      execution.stdout,
    ),
  };
};

export const gateStatic = async ({
  cwd,
  typecheckCommand,
  lintCommand,
  timeoutMs,
  lintFormat = "auto",
}: GateStaticOptions): Promise<StaticGateReport> => {
  const typecheck =
    typecheckCommand === undefined
      ? null
      : await runTypecheck(cwd, typecheckCommand, timeoutMs);
  const lint =
    lintCommand === undefined
      ? null
      : await runLint(cwd, lintCommand, timeoutMs, lintFormat);
  const gates = [typecheck, lint].filter(
    (gate): gate is StaticCommandReport => gate !== null,
  );

  return {
    ok: gates.length > 0 && gates.every((gate) => gate.exitCode === 0),
    ran: { typecheck: typecheck !== null, lint: lint !== null },
    typecheck,
    lint,
    totalErrors: gates.reduce((sum, gate) => sum + gate.errorCount, 0),
    totalWarnings: gates.reduce((sum, gate) => sum + gate.warningCount, 0),
  };
};
