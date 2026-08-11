import { flakeProbe } from "../../application/execution/flake-probe.ts";
import { gateStatic } from "../../application/execution/gate-static.ts";
import { execSuite } from "../../application/execution/run-suite.ts";
import { listView } from "../../application/listing/list-view.ts";
import { listPageInput, pageFor } from "../page.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  LINT_FORMATS,
  RUNNER_FAMILIES,
  SEPARATOR_MODES,
} from "test-forge-contracts/execution";
import { MAX_PAGE_LIMIT } from "test-forge-contracts/listing";
import { z } from "zod";

const runSuiteInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    command: z
      .string()
      .describe("The project test command, for example 'yarn test:backend'."),
    files: z
      .array(z.string())
      .describe("File filters appended to the command.")
      .default([]),
    family: z
      .enum(RUNNER_FAMILIES)
      .describe("Force the runner family instead of detecting it.")
      .optional(),
    timeoutMs: z
      .number()
      .describe("Hard timeout in milliseconds. Default 600000.")
      .optional(),
    includeTests: z
      .boolean()
      .describe(
        "Inline the first page of the per-test list beside its summary. The summary and the handle come back either way."
      )
      .default(false),
    extraArgs: z
      .array(z.string())
      .describe("Extra flags handed to the runner.")
      .default([]),
    separatorMode: z
      .enum(SEPARATOR_MODES)
      .describe("Controls the '--' separator between the command and the args.")
      .default("auto"),
    page: listPageInput.optional(),
  })
  .strict();

const flakeProbeInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    command: z.string().describe("The project test command."),
    files: z.array(z.string()).describe("Files under probe.").default([]),
    repeats: z
      .number()
      .describe("How many runs. Default 3, clamped to between 2 and 10.")
      .default(3),
    seed: z
      .number()
      .describe("Shuffle seed. The same seed reproduces the same order.")
      .default(1),
    family: z
      .enum(RUNNER_FAMILIES)
      .describe("Force the runner family instead of detecting it.")
      .optional(),
    timeoutMs: z
      .number()
      .describe("Hard timeout per run in milliseconds. Default 600000.")
      .optional(),
  })
  .strict();

const gateStaticInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    typecheckCommand: z
      .string()
      .describe("The type check command, for example 'yarn tsc'.")
      .optional(),
    lintCommand: z
      .string()
      .describe("The lint command, for example 'yarn lint:all'.")
      .optional(),
    timeoutMs: z
      .number()
      .describe("Hard timeout per command in milliseconds. Default 600000.")
      .optional(),
    lintFormat: z
      .enum(LINT_FORMATS)
      .describe(
        "How to read the lint output. 'auto' asks eslint for JSON when the command invokes it directly."
      )
      .default("auto"),
  })
  .strict();

export const registerExecutionTools = (server: McpServer): void => {
  server.registerTool(
    "runner_run_suite",
    {
      title: "Run the test suite",
      description: [
        "Runs the project test command with a machine-readable JSON reporter, parses the report, and returns counts and failures. It never returns raw log text, only a diagnostic tail when the exit code is unexplained.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- command (string): the project test command.",
        "- files (string[], default []): file filters appended to the command.",
        "- family ('vitest' | 'jest' | 'playwright' | 'mocha' | 'node-test' | 'unknown', optional): force the runner family.",
        "- timeoutMs (number, optional): hard timeout, default 600000.",
        "- includeTests (boolean, default false): inline the first page of the per-test list beside its summary.",
        "- extraArgs (string[], default []): extra runner flags.",
        "- separatorMode ('auto' | 'always' | 'never', default 'auto'): controls the '--' separator.",
        "- page (object, optional): { list: 'tests' | 'failures', offset, limit } opens a window of one list.",
        "",
        "Returns: { command: string, family: RunnerFamily, files: string[], exitCode: number | null, signal: string | null, timedOut: boolean, reportParsed: boolean, reportSource: 'report-file' | 'stdout' | null, reportError: string | null, exitCodeUnexplained: boolean, passed: number | null, failed: number | null, skipped: number | null, durationMs: number, diagnosticTail: string | null, tests: ListView, failures: ListView }. Each ListView carries { total, groups by status, sample, handle, page?, items? } and its handle path is a JSON file holding every row, so the whole per-test table survives even when it is not inlined.",
        "",
        "Examples:",
        "- Use it to prove a suite is green before a gate, or to collect the failure messages of a red one.",
        "- Use it with includeTests true when a later step needs the per-test names, and page for a window further in.",
        "- Do NOT use it to decide whether a suite is flaky from one green run: call runner_flake_probe, which repeats and shuffles.",
        "- Do NOT use it for the type check or the lint: call runner_gate_static.",
        "- Do NOT use it to prove a test bites: call mutation_batch_run.",
        "",
        "Truncation: both lists come back as bounded summaries, so a large suite no longer blows the 25000 character limit. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a timeout comes back as timedOut true with reportParsed false and the reason in reportError. An unparsable report returns reportParsed false with reportError naming both attempts, and diagnosticTail carries the last of the output. A non-zero exit with no failing test sets exitCodeUnexplained true.",
      ].join("\n"),
      inputSchema: runSuiteInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({
      cwd,
      command,
      files,
      family,
      timeoutMs,
      includeTests,
      extraArgs,
      separatorMode,
      page,
    }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const suite = await execSuite({
            cwd,
            command,
            files,
            extraArgs,
            separatorMode,
            ...(family === undefined ? {} : { family }),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          });
          const { tests, failures, ...rest } = suite;
          const requested = pageFor("tests", page);
          return {
            ...rest,
            tests: listView({
              kind: "suite-tests",
              items: tests,
              label: (test) => `${test.status} ${test.file}::${test.testName}`,
              group: (test) => test.status,
              page:
                requested ??
                (includeTests
                  ? { offset: 0, limit: MAX_PAGE_LIMIT }
                  : undefined),
            }),
            failures: listView({
              kind: "suite-failures",
              items: failures,
              label: (failure) =>
                `${failure.file}::${failure.testName}: ${failure.message}`,
              group: (failure) => failure.file,
              page: pageFor("failures", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "runner_flake_probe",
    {
      title: "Probe the suite for flakiness",
      description: [
        "Runs the same files several times, the last run in a seeded shuffled order, and reports whether every run agreed on counts and on the status of every test.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- command (string): the project test command.",
        "- files (string[], default []): files under probe.",
        "- repeats (number, default 3): clamped to between 2 and 10.",
        "- seed (number, default 1): the same seed reproduces the same order.",
        "- family (RunnerFamily, optional): force the runner family.",
        "- timeoutMs (number, optional): hard timeout per run, default 600000.",
        "",
        "Returns: { stable: boolean, seed: number, repeats: number, family: RunnerFamily, nativeShuffleSupported: boolean, unparsedRuns: Array<{ index, reportError }>, countsDiverge: boolean, divergences: Array<{ testKey, statuses, kind: 'presence' | 'status' }>, runs: Array<{ index, shuffled, fileOrder, nativeShuffleArgs, passed, failed, skipped, reportParsed, reportError, exitCode, durationMs, failures, testCount }> }.",
        "",
        "Examples:",
        "- Use it before accepting a new suite, to prove order independence.",
        "- Use it to name the test whose status moved between runs when a suite is suspected flaky.",
        "- Do NOT use it for a single verdict on green or red: call runner_run_suite once.",
        "- Do NOT use it to prove the tests assert anything: call mutation_generate and mutation_apply_and_run.",
        "",
        "Truncation: repeats multiply the payload and a wide probe can exceed the 25000 character limit. Narrow the result by lowering repeats and by passing fewer entries in files.",
        "",
        "Error handling: a run whose report cannot be parsed is listed in unparsedRuns and forces stable false, because agreement cannot be shown. A runner with no native shuffle still gets a seeded file order and reports nativeShuffleSupported false.",
      ].join("\n"),
      inputSchema: flakeProbeInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ cwd, command, files, repeats, seed, family, timeoutMs }) =>
      respondAsync("Lower repeats and pass fewer entries in files.", () =>
        flakeProbe({
          cwd,
          command,
          files,
          repeats,
          seed,
          ...(family === undefined ? {} : { family }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        })
      )
  );

  server.registerTool(
    "runner_gate_static",
    {
      title: "Run the static gate",
      description: [
        "Runs the type check command and the lint command, then returns the exit codes with parsed problem counts and locations. Both commands are optional and only the ones supplied are run.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- typecheckCommand (string, optional): for example 'yarn tsc'.",
        "- lintCommand (string, optional): for example 'yarn lint:all'.",
        "- timeoutMs (number, optional): hard timeout per command, default 600000.",
        "- lintFormat ('auto' | 'json' | 'text', default 'auto'): how to read the lint output.",
        "",
        "Returns: { ok: boolean, ran: { typecheck: boolean, lint: boolean }, typecheck: StaticCommandReport | null, lint: (StaticCommandReport & { format: 'json' | 'text' }) | null, totalErrors: number, totalWarnings: number }, where StaticCommandReport is { command, exitCode, timedOut, durationMs, parsed, errorCount, warningCount, problems: Array<{ file, line, column, severity, code, message }>, truncated, totalProblems, diagnosticTail }.",
        "",
        "Examples:",
        "- Use it as the static gate before a suite run, so a type error is named before a red test is blamed.",
        "- Use it with lintFormat 'text' when the project lint command already sets its own formatter.",
        "- Do NOT use it to run tests: call runner_run_suite.",
        "- Do NOT use it with neither command supplied; ok is false because nothing ran.",
        "",
        "Error handling: a command that times out returns timedOut true. A non-zero exit with no parsed problem sets parsed false and puts the last of the output in diagnosticTail. The problems list is capped by the parser, and truncated with totalProblems reports what was dropped.",
      ].join("\n"),
      inputSchema: gateStaticInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, typecheckCommand, lintCommand, timeoutMs, lintFormat }) =>
      respondAsync(
        "Run one command at a time by supplying only typecheckCommand or only lintCommand.",
        () =>
          gateStatic({
            cwd,
            lintFormat,
            ...(typecheckCommand === undefined ? {} : { typecheckCommand }),
            ...(lintCommand === undefined ? {} : { lintCommand }),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          })
      )
  );
};
