import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planCycle } from "../domain/cycle.ts";
import type { ExitDecision } from "../domain/exit.ts";
import { decideExit } from "../domain/exit.ts";
import { buildAgents, findBrief } from "../infrastructure/briefs.ts";
import { line as consoleLine } from "../infrastructure/console.ts";
import {
  ENTRY_COMMAND,
  RESOURCES_PATH,
} from "../infrastructure/install.ts";
import { latestOpenRun } from "../infrastructure/ledger.ts";
import { runCycle } from "../infrastructure/sdk.ts";
import type { CycleEvent } from "../infrastructure/sdk.ts";
import {
  loadSession,
  saveSession,
  sessionKeyOf,
} from "../infrastructure/session.ts";
import type { SessionState } from "../infrastructure/session.ts";
import { addUsage, printSpend } from "../infrastructure/spend.ts";
import {
  cyclePrompt,
  openingPrompt,
  planReplyPrompt,
  vectorLine,
  workLines,
} from "./prompts.ts";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { PREDICATE_NAMES } from "test-forge-contracts/gates";
import type { Scope } from "test-forge-contracts/project";
import { rulesFor } from "test-forge-mcp-server/src/application/codex/rules-for.ts";
import { evaluateGates } from "test-forge-mcp-server/src/application/gates/evaluate.ts";
import { runReopen } from "test-forge-mcp-server/src/application/ledger/run-reopen.ts";
import { runStart } from "test-forge-mcp-server/src/application/ledger/run-start.ts";
import { state } from "test-forge-mcp-server/src/application/ledger/state.ts";
import { resolveProject } from "test-forge-mcp-server/src/infrastructure/project.ts";

export type HumanKind = "gate" | "question" | "sign";

export type OperationHost = {
  line: (text: string) => void;
  askHuman?: (kind: HumanKind, text: string) => Promise<string | undefined>;
  mcpServers?: Record<string, McpServerConfig>;
  allowedTools?: readonly string[];
  env?: Record<string, string | undefined>;
};

export type OperationRequest = {
  cwd: string;
  scope: Scope | null;
  focus: string;
  operation: string;
  targets: string[];
  runId: number | null;
  openNew: boolean;
  approvePlan: boolean;
  host?: OperationHost;
};

export type OperationResult = {
  code: number;
  runId: number | null;
  exit: ExitDecision | null;
  costUsd: number;
  refusal?: string;
};

type ResolvedRun = {
  runId: number;
  opened: boolean;
  focusItems: number;
};

const PALMER_MODEL = "claude-opus-5-5";
const MAX_REOPENS = 3;
const APPROVE = /^\s*(approve|approved|yes|y|ok|go|continue)\b/i;
const STOP = /^\s*stop\b/i;
const SIGNATURE = /waive|waiver|equivalen|sign/i;

const OPERATION_DOCTRINE = readFileSync(
  join(RESOURCES_PATH, "doctrine", "operation.md"),
  "utf8",
);

const CONSOLE_HOST: OperationHost = { line: consoleLine };

const resolveRun = async (
  request: OperationRequest,
  projectKey: string,
): Promise<ResolvedRun> => {
  if (request.runId !== null) {
    await runReopen({ cwd: request.cwd, runId: request.runId });
    return { runId: request.runId, opened: false, focusItems: 0 };
  }
  if (!request.openNew) {
    const existing = latestOpenRun(projectKey);
    if (existing !== null) {
      return { runId: existing, opened: false, focusItems: 0 };
    }
  }
  if (request.scope === null) {
    throw new Error("--scope is required to open a run");
  }
  if (request.focus.trim().length === 0) {
    throw new Error("--focus or --focus-file is required to open a run");
  }

  const started = await runStart({
    cwd: request.cwd,
    focus: request.focus,
    scope: request.scope,
  });
  return {
    runId: started.runId,
    opened: true,
    focusItems: started.focusItems,
  };
};

const codexRefusal = async (
  cwd: string,
  scope: Scope | null,
): Promise<string | undefined> => {
  if (scope === null) return undefined;
  const { rules } = await rulesFor({ cwd, scope });
  if (rules.some((entry) => entry.acceptance !== null)) return undefined;
  return `This project has no accepted ${scope} codex. Test Forge enforces the repository's own doctrine, and there is nothing here to enforce. Run the rules session for scope ${scope} first, then start the operation again.`;
};

const resumeHint = (cwd: string, runId: number): string =>
  `  ${ENTRY_COMMAND} --cwd ${cwd} --run ${runId} --approve-plan`;

export const runOperation = async (
  request: OperationRequest,
): Promise<OperationResult> => {
  const host = request.host ?? CONSOLE_HOST;
  const say = host.line;
  const rule = (label: string): void =>
    say(`\n==== ${label} ${"=".repeat(Math.max(4, 72 - label.length))}`);
  const ask = host.askHuman;
  const hasAsk = ask !== undefined;
  const { cwd } = request;

  const refusal = request.runId === null
    ? await codexRefusal(cwd, request.scope)
    : undefined;
  if (refusal !== undefined) {
    say(refusal);
    return { code: 3, runId: null, exit: null, costUsd: 0, refusal };
  }

  const project = await resolveProject(cwd);
  const { runId, opened, focusItems } = await resolveRun(
    request,
    project.projectKey,
  );

  let snapshot = await state({ cwd, runId });
  if (snapshot.run.exitKind !== null) {
    const recorded = snapshot.run.exitReason ?? "";
    say(
      `Run ${runId} already exited ${snapshot.run.exitKind}: ${
        recorded.length > 0 ? recorded : "no reason recorded"
      }`,
    );
    say("Open a new one with --new.");
    return {
      code: 0,
      runId,
      exit: { kind: snapshot.run.exitKind, reason: recorded },
      costUsd: 0,
    };
  }

  let gates = await evaluateGates({ cwd, runId });

  const key = sessionKeyOf(project.projectKey, runId);
  let session: SessionState = loadSession(key);

  const agents = buildAgents();
  const palmer = findBrief("palmer");
  const systemPromptAppend = `${palmer.body}\n\n---\n\n${OPERATION_DOCTRINE}`;
  const abortController = new AbortController();
  const startedAt = Date.now();
  let interrupted = false;

  const onSigint = (): void => {
    if (interrupted) process.exit(130);
    interrupted = true;
    say("\nInterrupt received. Finishing the stream, then saving the session.");
    abortController.abort();
  };
  process.on("SIGINT", onSigint);

  const onEvent = (event: CycleEvent): void => {
    if (event.kind === "session") {
      if (session.sessionId === event.sessionId) return;
      session = { ...session, sessionId: event.sessionId };
      saveSession(key, session);
      return;
    }
    if (event.kind === "text") {
      say(event.text);
      return;
    }
    if (event.kind === "tool") {
      say(`  -> ${event.label}`);
      return;
    }
    if (event.kind === "task") {
      say(`  .. ${event.description} started`);
      return;
    }
    say(event.text);
  };

  rule("TEST FORGE");
  say(`Project      ${project.projectKey} (${project.shortName})`);
  say(`Root         ${project.rootPath}`);
  say(`Scope        ${snapshot.run.scope}`);
  say(
    `Run          ${runId} ${
      opened ? `opened, ${focusItems} focus items` : "resumed"
    }`,
  );
  say(`Session      ${session.sessionId ?? "new"}`);
  say(`Subagents    ${Object.keys(agents).length} callsigns loaded`);
  say(`Human        ${hasAsk ? "reachable through ask" : "not at the console"}`);

  let approved = request.approvePlan;
  let pendingPrompt: string | null = null;
  let exit: ExitDecision | null = null;
  let cyclesWithoutPass = 0;
  let reopens = 0;

  const finish = (result: OperationResult): OperationResult => {
    process.off("SIGINT", onSigint);
    return result;
  };

  while (exit === null && !interrupted) {
    const cycle = session.cycles + 1;
    const opening = session.sessionId === null;
    const assignment = planCycle(gates.predicates, gates.workList);
    const prompt =
      pendingPrompt ??
      (opening
        ? openingPrompt({
            operation: request.operation,
            focus: snapshot.run.focus,
            scope: snapshot.run.scope,
            targets: request.targets,
            runId,
            project,
            cwd,
            approved,
            hasAsk,
          })
        : cyclePrompt(
            {
              cycle,
              runId,
              cwd,
              passes: snapshot.passes.length,
              passStalled: snapshot.latestPass?.stalled ?? false,
              openFindings: snapshot.findings.filter(
                (finding) => finding.status === "open",
              ).length,
              survivingMutants: snapshot.mutation.surviving.length,
              pendingMutants: snapshot.mutation.pending,
              units: snapshot.units,
              hasAsk,
              elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
            },
            gates.predicates,
            assignment,
          ));
    pendingPrompt = null;

    rule(`CYCLE ${cycle}`);
    const cycleStartedAt = Date.now();
    const passesBefore = snapshot.passes.length;

    const outcome = await runCycle({
      prompt,
      cwd,
      projectRoot: project.rootPath,
      agents,
      systemPromptAppend,
      resume: session.sessionId,
      abortController,
      onEvent,
      model: palmer.model ?? PALMER_MODEL,
      effort: palmer.effort ?? "medium",
      extraServers: host.mcpServers,
      extraAllowedTools: host.allowedTools,
      env: host.env,
    });

    session = {
      ...addUsage(session, outcome.usage, cycle, !opening),
      sessionId: session.sessionId,
    };
    saveSession(key, session);

    snapshot = await state({ cwd, runId });
    gates = await evaluateGates({ cwd, runId });

    rule("SPEND");
    printSpend({
      cycle,
      usage: outcome.usage,
      cycleMs: Date.now() - cycleStartedAt,
      totals: session,
      elapsedMs: Date.now() - startedAt,
    });
    say(`Vector       ${vectorLine(gates.predicates)}`);

    if (interrupted) break;

    if (!approved) {
      rule("PLAN");
      const plan = outcome.resultText.trim();
      if (plan.length > 0) say(plan);
      if (ask === undefined) {
        say(
          `\nThe plan is Captain Lasky's to approve. Re-run with:\n${resumeHint(
            cwd,
            runId,
          )}`,
        );
        return finish({ code: 0, runId, exit: null, costUsd: session.costUsd });
      }
      const answer = await ask(
        "gate",
        `${plan}\n\n---\nTest Forge run ${runId}. Reply "approve" to start the operation, "stop" to end it here, or write what must change in the plan.`,
      );
      if (answer === undefined || STOP.test(answer)) {
        return finish({
          code: 0,
          runId,
          exit: { kind: "BLOCKED", reason: answer === undefined ? "no answer at the plan gate" : "the human stopped at the plan gate" },
          costUsd: session.costUsd,
        });
      }
      approved = APPROVE.test(answer);
      pendingPrompt = planReplyPrompt(
        approved,
        approved ? answer.replace(APPROVE, "").trim() : answer,
      );
      continue;
    }

    cyclesWithoutPass =
      snapshot.passes.length > passesBefore ? 0 : cyclesWithoutPass + 1;

    exit = decideExit({
      recordedKind: snapshot.run.exitKind,
      recordedReason: snapshot.run.exitReason ?? "",
      closingText: outcome.resultText,
      allTrue: planCycle(gates.predicates, gates.workList).allTrue,
      passStalled: snapshot.latestPass?.stalled ?? false,
      cyclesWithoutPass,
    });

    if (exit?.kind === "BLOCKED" && ask !== undefined && reopens < MAX_REOPENS) {
      const answer = await ask(
        SIGNATURE.test(exit.reason) ? "sign" : "question",
        `Test Forge run ${runId} is blocked:\n\n${exit.reason}`,
      );
      if (answer !== undefined && !STOP.test(answer)) {
        await runReopen({ cwd, runId });
        reopens += 1;
        snapshot = await state({ cwd, runId });
        pendingPrompt = `Captain Lasky answered your BLOCKED question:\n<answer>\n${answer}\n</answer>\nThe host reopened run ${runId}. Record what his answer requires, then continue the operation.`;
        exit = null;
        cyclesWithoutPass = 0;
      }
    }
  }

  if (exit === null) {
    rule("INTERRUPTED");
    say(`Run ${runId} is still open. Resume with:`);
    say(resumeHint(cwd, runId));
    return finish({ code: 130, runId, exit: null, costUsd: session.costUsd });
  }

  rule(exit.kind);
  say(exit.reason.length > 0 ? exit.reason : "No reason recorded.");

  if (exit.kind === "BLOCKED") {
    say("\nAnswer the question, then resume with:");
    say(resumeHint(cwd, runId));
    return finish({ code: 0, runId, exit, costUsd: session.costUsd });
  }

  if (exit.kind === "STALLED") {
    const board = planCycle(gates.predicates, gates.workList);
    say(
      `Predicates that did not move: ${board.failing
        .map((id) => `${id} ${PREDICATE_NAMES[id]}`)
        .join(", ")}`,
    );
    say(workLines(board.groups));
    return finish({ code: 1, runId, exit, costUsd: session.costUsd });
  }

  const confirmed = snapshot.findings.filter(
    (finding) =>
      finding.status === "confirmed-defect" ||
      finding.status === "confirmed-but-known",
  );
  say(`Units accepted: ${snapshot.unitCounts["accepted"] ?? 0}`);
  say(`Defects confirmed and still red: ${confirmed.length}`);
  for (const finding of confirmed) {
    say(`  - ${finding.findingKey}: ${finding.title}`);
  }
  say(`Waivers signed: ${snapshot.waivers.length}`);
  return finish({ code: 0, runId, exit, costUsd: session.costUsd });
};
