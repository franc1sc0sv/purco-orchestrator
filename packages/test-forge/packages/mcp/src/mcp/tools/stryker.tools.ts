import {
  harnessStart,
  harnessStatus,
  harnessStop,
} from "../../application/stryker/harness.ts";
import { extraOperators } from "../../application/stryker/extra-operators.ts";
import { mutationPass } from "../../application/stryker/mutation-pass.ts";
import { strykerRun } from "../../application/stryker/run.ts";
import { strykerScope } from "../../application/stryker/scope.ts";
import { timeoutRecheck } from "../../application/stryker/solo.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SCOPE_RULES } from "test-forge-contracts/stryker";
import type { ScopeSelection } from "test-forge-contracts/stryker";
import { z } from "zod";

const cwdField = z
  .string()
  .describe("Absolute path of the ticket worktree (the repository root).");

const harnessStartInput = z
  .object({
    cwd: cwdField,
    concurrency: z
      .number()
      .int()
      .describe(
        "Stryker workers the harness prepares seed templates for. Default min(12, cpus - 3). The harness holds 4 templates per worker.",
      )
      .optional(),
    projectConfigFile: z
      .string()
      .describe("Repository relative vitest config. Default 'vitest.config.mts'.")
      .optional(),
    globalSetupFile: z
      .string()
      .describe(
        "Repository relative global setup run once. Default 'tests/integration/setups/global-setup.ts'.",
      )
      .optional(),
    bootTimeoutMs: z
      .number()
      .int()
      .describe("Wait for the harness. Default 600000.")
      .optional(),
    holdTimeoutMs: z
      .number()
      .int()
      .describe("How long the harness stays up. Default 21600000.")
      .optional(),
  })
  .strict();

const cwdOnlyInput = z.object({ cwd: cwdField }).strict();

const harnessStopInput = z
  .object({
    cwd: cwdField,
    drainTimeoutMs: z
      .number()
      .int()
      .describe("Wait for the harness to tear itself down. Default 180000.")
      .optional(),
  })
  .strict();

const scopeFields = {
  cwd: cwdField,
  base: z
    .string()
    .describe(
      "Base branch name. The diff is taken against the merge base of HEAD and origin/<base>, so 'dev' means origin/dev.",
    ),
  files: z
    .array(z.string())
    .describe(
      "Repository relative production files to restrict the scope to. Default every changed production .ts/.tsx file.",
    )
    .optional(),
  testFiles: z
    .array(z.string())
    .describe(
      "Repository relative test files Stryker runs. Default the changed test files plus every test file that reaches a changed file through any chain of imports (relative, tsconfig path and ~/ or @/ aliases).",
    )
    .optional(),
  hubImporterLimit: z
    .number()
    .int()
    .describe(
      "Import chains stop at a file imported by more than this many files (a hub such as a test setup, the trpc entry or the DI container), because every test reaches the whole app through hubs. Default 25. Pass a very large number for a literal transitive closure.",
    )
    .optional(),
  scopeRule: z
    .enum(SCOPE_RULES)
    .describe(
      "'span-overlap' (default): a mutant is in scope when its span touches any changed line. 'start-line': only when it starts on a changed line.",
    )
    .optional(),
};

const scopeInput = z.object(scopeFields).strict();

const runInput = z
  .object({
    ...scopeFields,
    runId: z
      .number()
      .int()
      .describe(
        "Ledger run id. Without it nothing is written to the ledger and the result only reports.",
      )
      .optional(),
    label: z
      .string()
      .describe("Name of the report and event files. Default the run id.")
      .optional(),
    concurrency: z
      .number()
      .int()
      .describe("Stryker workers. Default min(12, cpus - 3).")
      .optional(),
    timeoutFactor: z
      .number()
      .describe("Stryker timeoutFactor. Default 1.5.")
      .optional(),
    timeoutMs: z
      .number()
      .int()
      .describe("Stryker timeoutMS added to the measured test time. Default 20000.")
      .optional(),
    inPlace: z
      .boolean()
      .describe(
        "Mutate the worktree files in place. Default false: Stryker works in a sandbox copy and never touches the worktree sources.",
      )
      .optional(),
  })
  .strict();

const soloFields = {
  cwd: cwdField,
  runId: z
    .number()
    .int()
    .describe("Ledger run id whose Stryker rows are read and updated."),
};

const soloInput = z.object(soloFields).strict();

const extraOperatorsInput = z
  .object({ ...scopeFields, runId: soloFields.runId })
  .strict();

const mutationPassInput = z
  .object({
    ...runInput.shape,
    runId: soloFields.runId,
    bootTimeoutMs: z
      .number()
      .int()
      .describe("Wait for the harness to boot. Default 600000.")
      .optional(),
    holdTimeoutMs: z
      .number()
      .int()
      .describe("How long the harness stays up. Default 21600000.")
      .optional(),
  })
  .strict();

const summaryOf = (selection: ScopeSelection) => ({
  kind: selection.kind,
  files: selection.files,
  testFiles: selection.testFiles,
  inScope: selection.inScope.length,
  overlapOnly: selection.overlapOnly.length,
  uncovered: selection.uncovered.length,
  inScopePerFile: Object.fromEntries(
    selection.files.map((file) => [
      file,
      selection.inScope.filter((site) => site.file === file).length +
        selection.uncovered.filter((site) => site.file === file).length,
    ]),
  ),
});

export const registerStrykerTools = (server: McpServer): void => {
  server.registerTool(
    "stryker_harness_start",
    {
      title: "Boot the mutation test environment of one worktree",
      description: [
        "Boots, once per ticket worktree, the project's global setup (containers, migrations, seed), clones one seed template per worker slot (4 per worker) and switches Postgres to fast flags (fsync, synchronous_commit, full_page_writes off). A detached process holds the containers until stryker_harness_stop. Generated files go into the git-ignored .test-forge/ folder of the worktree; nothing tracked is edited and nothing is installed into the worktree.",
        "",
        "Returns: { ok: true, reused, state: { pid, concurrency, templates, manifestPath, containerIds, ... }, bootMs } or { ok: false, reason, bootLogTail }.",
        "",
        "Examples:",
        "- Use it once before stryker_run when backend files changed.",
        "- Do NOT use it for frontend-only changes: the frontend run needs no harness.",
        "- Do NOT leave it running: stryker_harness_stop removes every container it started.",
      ].join("\n"),
      inputSchema: harnessStartInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      respondAsync("Start one worktree per call.", () => harnessStart(input)),
  );

  server.registerTool(
    "stryker_harness_status",
    {
      title: "Report the mutation test environment of one worktree",
      description: [
        "Reports whether the harness of a worktree is running, whether its manifest is ready, and which of the containers it started are still alive.",
        "",
        "Returns: { running, manifestReady, state, liveContainerIds }.",
      ].join("\n"),
      inputSchema: cwdOnlyInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      respondAsync("Ask about one worktree per call.", () =>
        harnessStatus(input),
      ),
  );

  server.registerTool(
    "stryker_harness_stop",
    {
      title: "Release the mutation test environment of one worktree",
      description: [
        "Asks the held environment to finish (it drops the seed templates and runs the project's own teardown), signals the boot process only when it does not finish, then force-removes every container the harness recorded at boot that is still running.",
        "",
        "Returns: { ok, teardownClean, killed, removedContainerIds, leftoverContainerIds }. ok is false when a recorded container is still running.",
      ].join("\n"),
      inputSchema: harnessStopInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      respondAsync("Stop one worktree per call.", () => harnessStop(input)),
  );

  server.registerTool(
    "stryker_scope",
    {
      title: "Count the mutants that touch the changed lines",
      description: [
        "Lists every Stryker mutant of each changed production .ts/.tsx file (instrumenter, no tests run) and keeps the ones in scope. The diff is git diff -U0 against the merge base with origin/<base>, including uncommitted and untracked files; test files are excluded. Every selected mutant gets a column precise range, so Stryker runs all of them and none is skipped.",
        "",
        "Returns: { ok: true, baseRef, mergeBase, scopeRule, selections: [{ kind, files, testFiles, inScope, overlapOnly, uncovered, inScopePerFile }], inScope, overlapOnly, selectionMs, instrumentFailures } or { ok: false, reason }. overlapOnly counts mutants that reach a changed line without starting on one. uncovered counts in-scope mutants of a kind that has no test file; they are recorded as no_coverage without a run.",
      ].join("\n"),
      inputSchema: scopeInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      respondAsync("Restrict the scope with files.", async () => {
        const result = await strykerScope(input);
        if (!result.ok) return result;
        return {
          ...result,
          selections: result.selections.map(summaryOf),
        };
      }),
  );

  server.registerTool(
    "stryker_run",
    {
      title: "Run Stryker on the mutants that touch the changed lines",
      description: [
        "Selects the in-scope mutants (see stryker_scope), runs Stryker from the ticket worktree (backend and frontend as separate runs, each only when it has in-scope mutants), and writes every in-scope mutant to the ledger mutants table when runId is given. Outcomes: killed, survived, no_coverage, timeout_pending (a Stryker Timeout, to be re-checked alone), unviable (compile error), error, out_of_scope (mutants Stryker generated inside the ranges that no changed line touches; never gate on them). Killing tests go to the kills table, covering tests to covered_by_json. An incremental file per kind keeps results across calls, so a second call re-runs only mutants whose code or covering tests changed.",
        "",
        "Backend needs stryker_harness_start first. Stryker works in a sandbox copy of the worktree, so the worktree sources are never touched.",
        "",
        "Returns: { ok: true, runId, inScope, outOfScope, overlapOnly, uncovered, counts, durations: { selectionMs, strykerMs, ledgerMs, totalMs }, reportPath, runs: [{ kind, counts, dryRunMs, mutationMs, reportPath, eventsPath, ... }], ledgerRows } or { ok: false, reason }.",
      ].join("\n"),
      inputSchema: runInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      respondAsync("Restrict the run with files.", () => strykerRun(input)),
  );

  server.registerTool(
    "stryker_timeout_recheck",
    {
      title: "Re-run every pending Stryker timeout alone",
      description: [
        "Takes every timeout_pending mutant of a run and re-runs it alone: the replacement is written at the exact span of the worktree file, only its covering test files run with the generated vitest config (one file at a time, bail on first failure), and the file is restored byte for byte afterwards. The limit is 3 x the measured passing time of those test files plus 10 s. Timeout again: killed_by_timeout (solid). A test fails: killed, the test is recorded. Everything passes: survived.",
        "",
        "The original file is backed up in the git-ignored .test-forge/solo-backup folder, restored in a finally block and verified by hash. A backup left by a crash is restored at the start of every call. Backend mutants need stryker_harness_start first.",
        "",
        "Returns: { ok: true, runId, checked, counts, results: [{ mutantId, file, line, mutator, outcome, strykerStatus, killedBy, testFiles, baselineMs, limitMs, durationMs, reason }], recoveredBackups, durationMs } or { ok: false, reason }.",
      ].join("\n"),
      inputSchema: soloInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      respondAsync("Re-check one run per call.", () => timeoutRecheck(input)),
  );

  server.registerTool(
    "stryker_extra_operators",
    {
      title: "Run the extra mutation operators Stryker does not have",
      description: [
        "Generates, with an AST parser and the same scope rule as stryker_scope, three operators Stryker 10 lacks (it has no custom mutator API): ExtraJsxBooleanAttribute (a boolean looking JSX attribute value to {true} and {false}), ExtraLogicalOperand (each operand of && and || to true and to false), ExtraNumberLiteral (a runtime number n to 0 and to n + 1, never in types). A replacement identical to the original, or a mutant Stryker already has at the same file, span and replacement, is skipped.",
        "",
        "The covering tests come from the Stryker mutants of the same run on the same lines; none means no_coverage and no run. The others run through the solo runner (see stryker_timeout_recheck) and the outcomes are stored in the ledger like Stryker mutants (killed, survived, killed_by_timeout, no_coverage). Call stryker_run with the same runId first. Backend mutants need stryker_harness_start first.",
        "",
        "Returns: { ok: true, runId, scopeRule, generated, duplicatesOfStryker, noCoverage, byMutator, generateMs, checked, counts, results, recoveredBackups, durationMs } or { ok: false, reason }.",
      ].join("\n"),
      inputSchema: extraOperatorsInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      respondAsync("Restrict the run with files.", () => extraOperators(input)),
  );

  server.registerTool(
    "stryker_mutation_pass",
    {
      title: "Run a whole mutation pass on the changed lines",
      description: [
        "One call for the mutation phase of a ticket: restores any leftover solo backup, resolves the scope, starts the backend harness (only when backend mutants are in scope), runs Stryker, runs the extra operators, re-checks every timeout alone, stops the harness it started, and reconciles.",
        "",
        "Returns: { ok: true, runId, scopeRule, harnessStarted, harnessStopped, testFiles, counts, stryker, extras, timeoutRecheck, reconciliation, stages, totalMs } or { ok: false, reason, stages }. reconciliation has changedFiles, changedLines, inScopeStryker, inScopeExtra, inScopeExpected, inScopeInLedger, finalStates, withoutFinalState (must be empty) and consistent. Blocks for the whole pass (many minutes); the engine should call mutationPass in process.",
      ].join("\n"),
      inputSchema: mutationPassInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ bootTimeoutMs, holdTimeoutMs, ...input }) =>
      respondAsync("Restrict the pass with files.", () =>
        mutationPass({ ...input, harness: { bootTimeoutMs, holdTimeoutMs } }),
      ),
  );
};
