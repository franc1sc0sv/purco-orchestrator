import { runOperation } from "./application/run-operation.ts";
import { line } from "./infrastructure/console.ts";
import { ENTRY_COMMAND } from "./infrastructure/install.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { isScope } from "test-forge-contracts/project";
import type { Scope } from "test-forge-contracts/project";

const USAGE = `TEST FORGE headless runner - the host for Commander Palmer.

  ${ENTRY_COMMAND} --scope backend --focus "<the run focus>" [options]

Options
  --cwd <path>        A path inside the target repository. Default: the process cwd.
  --scope <name>      backend | frontend. Required when a run is opened.
  --focus <text>      The run focus, verbatim. One line becomes one D9 item.
  --focus-file <path> Read the focus from a file instead.
  --operation <text>  What Captain Lasky asked for, verbatim. Defaults to the focus.
  --target <path>     A production or test file the operation concerns. Repeatable.
  --run <id>          Resume this run id instead of opening or reusing one.
  --new               Open a new run even when an open one exists.
  --approve-plan      Captain Lasky has read the plan and approves spawning.
  --help              This text.

The host never stops for cost. It stops on DONE, BLOCKED or STALLED.`;

const scopeOf = (value: string | undefined): Scope | null => {
  if (value === undefined) return null;
  if (!isScope(value)) {
    throw new Error(`--scope must be backend or frontend but was "${value}"`);
  }
  return value;
};

const runIdOf = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const runId = Number(value);
  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error(`--run must be a run id but was "${value}"`);
  }
  return runId;
};

const main = async (): Promise<number> => {
  const { values } = parseArgs({
    options: {
      cwd: { type: "string" },
      scope: { type: "string" },
      focus: { type: "string" },
      "focus-file": { type: "string" },
      operation: { type: "string" },
      target: { type: "string", multiple: true },
      run: { type: "string" },
      new: { type: "boolean" },
      "approve-plan": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help === true) {
    line(USAGE);
    return 0;
  }

  const focusFile = values["focus-file"];
  const focus =
    focusFile === undefined
      ? values.focus ?? ""
      : readFileSync(resolve(focusFile), "utf8");

  return runOperation({
    cwd: resolve(values.cwd ?? process.cwd()),
    scope: scopeOf(values.scope),
    focus,
    operation: values.operation ?? focus,
    targets: values.target ?? [],
    runId: runIdOf(values.run),
    openNew: values.new === true,
    approvePlan: values["approve-plan"] === true,
  });
};

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    line(
      `\nHost failure: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  });
