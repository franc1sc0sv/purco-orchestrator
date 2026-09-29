import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Orchestrator } from "./orchestrator.ts";
import { describeStep, planSteps } from "./plan.ts";
import { phaseGate } from "./gates.ts";
import { Store } from "./store.ts";
import { checkMcp } from "./check.ts";
import { startMonitor } from "./monitor.ts";
import { PHASES, SPIKE_PHASES, type Phase, type RunConfig } from "./types.ts";
import { isWorkflowName, WORKFLOWS, type WorkflowName } from "./workflows.ts";

const GAF = path.join(
  process.env.HOME ?? "",
  "projects/purco-projects/general-access-files",
);

const digits = (value: string): string =>
  value
    .split("")
    .filter((char) => char >= "0" && char <= "9")
    .join("");

const die = (message: string): never => {
  process.stderr.write(`purco-orchestrate: ${message}\n`);
  process.exit(1);
};

const usage = `purco-orchestrate <TICKET> [options]
purco-orchestrate monitor [--port <n>]

  --workflow <name>    ticket (default), spike or test
  --phases <list>      comma separated, default: every phase of the workflow
  --targets <text>     test workflow: the use cases or files to test
  --focus <text>       test workflow: what the operation must prove, one line each
  --scope <name>       test step: backend or frontend, default from the changed files
  --worktree <path>    default: the worktree whose branch matches the ticket
  --model <id>         override every role's model; default is per role
  --budget <usd>       abort the run when the total cost passes this
  --resume             skip every phase this run already finished
  --max-turns <n>      per phase, default 200
  --dry-run            print the plan and exit
  --no-write           run every agent read-only
  --non-interactive    never block on a human question
  --ask-human          send every agent question straight to the human,
                       skipping the lead
  --mailbox-db <file>  route human questions through the SQLite mailbox;
                       required whenever stdin is not a terminal
  --run-id <id>        pin the run id, so census, questions and phases share it
  --config-dir <path>  Claude config profile, default CLAUDE_CONFIG_DIR
  --check-mcp          probe linear, playwright and postgres, then exit

monitor serves a live page for every run on disk, default port 4317.

Postgres runs in-process and read-only, and resolves its own connection: it
tries the configured value, then the tenant name as the database, then the
other tenant's credentials. Override with ORCH_PG_DB_PURCO / ORCH_PG_DB_SDI.
`;

const parseArgs = (argv: string[]) => {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
};

const resolveWorktree = (ticketNumber: string): string => {
  const root = path.join(
    process.env.HOME ?? "",
    "projects/purco-projects/purco-web",
  );
  const listing = execFileSync(
    "git",
    ["-C", root, "worktree", "list", "--porcelain"],
    { encoding: "utf8" },
  );
  let current = "";
  for (const line of listing.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice(9);
    if (line.startsWith("branch ") && line.includes(ticketNumber) && current) {
      return current;
    }
  }
  return die(
    `no worktree found for PURCO-${ticketNumber}. Create one with /wt ${ticketNumber}.`,
  );
};

const main = async (): Promise<void> => {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (positional.length === 0 || flags.help) {
    process.stderr.write(usage);
    process.exit(positional.length === 0 ? 1 : 0);
  }

  if (positional[0] === "monitor") {
    const port = typeof flags.port === "string" ? Number(flags.port) : 4317;
    startMonitor(port);
    return;
  }

  const number = digits(positional[0]);
  if (!number) die(`could not read a ticket number from "${positional[0]}"`);
  const ticket = `PURCO-${number}`;

  const namesSpikePhase =
    typeof flags.phases === "string" &&
    flags.phases
      .split(",")
      .some((phase) => SPIKE_PHASES.includes(phase.trim() as Phase));
  const workflowFlag =
    typeof flags.workflow === "string"
      ? flags.workflow
      : namesSpikePhase
        ? "spike"
        : "ticket";
  if (!isWorkflowName(workflowFlag)) {
    die(`unknown workflow "${workflowFlag}". Known: ${Object.keys(WORKFLOWS).join(", ")}`);
  }
  const workflow = workflowFlag as WorkflowName;

  const phases = (
    typeof flags.phases === "string"
      ? flags.phases.split(",").map((phase) => phase.trim())
      : WORKFLOWS[workflow].phases
  ) as Phase[];
  for (const phase of phases) {
    if (!PHASES.includes(phase)) {
      die(`unknown phase "${phase}". Known: ${PHASES.join(", ")}`);
    }
  }

  const worktree =
    typeof flags.worktree === "string"
      ? flags.worktree
      : resolveWorktree(number);
  if (!fs.existsSync(worktree)) die(`worktree does not exist: ${worktree}`);

  const contextPack = path.join(GAF, ticket);
  fs.mkdirSync(contextPack, { recursive: true });

  const generatedRunId = new Date()
    .toISOString()
    .slice(0, 19)
    .split(":")
    .join("-")
    .split(".")
    .join("-");
  const runId =
    typeof flags["run-id"] === "string" && flags["run-id"].length > 0
      ? flags["run-id"]
      : generatedRunId;

  const runDir = path.join(contextPack, "orchestrator-runs", runId);

  const config: RunConfig = {
    workflow,
    ticket,
    worktree,
    contextPack,
    runDir,
    runId,
    phases,
    modelOverride: typeof flags.model === "string" ? flags.model : undefined,
    budgetUsd:
      typeof flags.budget === "string" ? Number(flags.budget) : undefined,
    resume: flags.resume === true,
    maxTurnsPerPhase:
      typeof flags["max-turns"] === "string" ? Number(flags["max-turns"]) : 200,
    autoApproveWrites: flags["no-write"] !== true,
    nonInteractive: flags["non-interactive"] === true,
    askHuman: flags["ask-human"] === true,
    mailboxDb:
      typeof flags["mailbox-db"] === "string" ? flags["mailbox-db"] : undefined,
    configDir:
      typeof flags["config-dir"] === "string"
        ? flags["config-dir"]
        : (process.env.CLAUDE_CONFIG_DIR ??
          path.join(process.env.HOME ?? "", ".claude-work")),
    testTargets:
      typeof flags.targets === "string" ? flags.targets : undefined,
    testFocus: typeof flags.focus === "string" ? flags.focus : undefined,
    testScope:
      flags.scope === "backend" || flags.scope === "frontend"
        ? flags.scope
        : undefined,
  };

  process.stderr.write(
    [
      `ticket    ${config.ticket}`,
      `workflow  ${config.workflow}`,
      `worktree  ${config.worktree}`,
      `pack      ${config.contextPack}`,
      `phases    ${config.phases.join(" > ")}`,
      `model     ${config.modelOverride ?? "per role"}`,
      `budget    ${config.budgetUsd ? `$${config.budgetUsd}` : "none"}`,
      `writes    ${config.autoApproveWrites ? "enabled" : "read-only"}`,
      `run dir   ${config.runDir}`,
      "",
    ].join("\n"),
  );

  if (flags["check-mcp"] === true) {
    process.exit(await checkMcp(ticket, config.configDir));
  }

  if (
    !process.stdin.isTTY &&
    !config.mailboxDb &&
    !config.nonInteractive &&
    flags["dry-run"] !== true
  ) {
    process.stderr.write(
      [
        "ERROR: stdin is not a terminal, so a human question can never be answered.",
        "",
        "Without --mailbox-db the run falls back to readline on stdin and hangs",
        "silently on the first question, with no error and no way to reply.",
        "Pass the ticket's store so questions reach the session that launched it:",
        "",
        "  --mailbox-db <general-access-files>/<TICKET>/orchestrator.sqlite",
        "",
        "Or pass --non-interactive to record questions as open decisions instead.",
        "",
      ].join("\n"),
    );
    process.exit(2);
  }

  const spikePhases = config.phases.filter((phase) =>
    SPIKE_PHASES.includes(phase),
  );
  if (spikePhases.length > 0 && !config.mailboxDb) {
    process.stderr.write(
      [
        `ERROR: ${spikePhases.join(", ")} ${spikePhases.length === 1 ? "needs" : "need"} the spike store, so --mailbox-db is required.`,
        "",
        "Without it the spike MCP server is never built, the surveyor's worklist,",
        "triage and finish tools do not exist, and the run fails on its first call",
        "with nothing recorded. Pass the ticket's store:",
        "",
        "  --mailbox-db <general-access-files>/<TICKET>/orchestrator.sqlite",
        "",
      ].join("\n"),
    );
    process.exit(2);
  }

  if (flags["dry-run"] === true) {
    if (config.mailboxDb) {
      try {
        const store = new Store(config.mailboxDb, config.runId);
        const steps = planSteps(config.phases, store);
        const gates = [...new Set(config.phases)].map(
          (phase) => `  ${phase.padEnd(12)}${phaseGate(phase, store, config.contextPack).ok ? "open" : "REFUSED"}  ${phaseGate(phase, store, config.contextPack).reason}`,
        );
        store.close();
        process.stderr.write(
          `\nsteps     ${steps.length}\n${steps.map((step, i) => `  ${String(i + 1).padStart(3)}. ${describeStep(step)}`).join("\n")}\n\ngates\n${gates.join("\n")}\n`,
        );
      } catch (error) {
        process.stderr.write(`\ncould not plan from the store: ${String(error)}\n`);
      }
    }
    process.stderr.write("\ndry run, nothing executed\n");
    return;
  }

  const orchestrator = new Orchestrator(config);
  const outcomes = await orchestrator.run();

  process.stderr.write(`\nreport ${path.join(config.runDir, "report.md")}\n`);
  const failed = outcomes.some(
    (outcome) => outcome.status === "failed" || outcome.status === "escalated",
  );
  process.exit(failed ? 2 : 0);
};

main().catch((error) => {
  process.stderr.write(`purco-orchestrate: ${String(error)}\n`);
  process.exit(1);
});
