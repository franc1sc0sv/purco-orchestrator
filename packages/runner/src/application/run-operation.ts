import { planCycle } from "../domain/cycle.ts";
import type { ExitDecision } from "../domain/exit.ts";
import { decideExit } from "../domain/exit.ts";
import { buildAgents, findBrief } from "../infrastructure/briefs.ts";
import { line, rule } from "../infrastructure/console.ts";
import { ENTRY_COMMAND } from "../infrastructure/install.ts";
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
  vectorLine,
  workLines,
} from "./prompts.ts";
import { PREDICATE_NAMES } from "test-forge-contracts/gates";
import type { Scope } from "test-forge-contracts/project";
import { evaluateGates } from "test-forge-mcp-server/src/application/gates/evaluate.ts";
import { runStart } from "test-forge-mcp-server/src/application/ledger/run-start.ts";
import { state } from "test-forge-mcp-server/src/application/ledger/state.ts";
import { resolveProject } from "test-forge-mcp-server/src/infrastructure/project.ts";

export type OperationRequest = {
  cwd: string;
  scope: Scope | null;
  focus: string;
  operation: string;
  targets: string[];
  runId: number | null;
  openNew: boolean;
  approvePlan: boolean;
};

type ResolvedRun = {
  runId: number;
  opened: boolean;
  focusItems: number;
};

const resolveRun = async (
  request: OperationRequest,
  projectKey: string,
): Promise<ResolvedRun> => {
  if (request.runId !== null) {
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

const resumeHint = (cwd: string, runId: number): string =>
  `  ${ENTRY_COMMAND} --cwd ${cwd} --run ${runId} --approve-plan`;

export const runOperation = async (
  request: OperationRequest,
): Promise<number> => {
  const { cwd } = request;
  const project = await resolveProject(cwd);
  const { runId, opened, focusItems } = await resolveRun(
    request,
    project.projectKey,
  );

  let snapshot = await state({ cwd, runId });
  if (snapshot.run.exitKind !== null) {
    const recorded = snapshot.run.exitReason ?? "";
    line(
      `Run ${runId} already exited ${snapshot.run.exitKind}: ${
        recorded.length > 0 ? recorded : "no reason recorded"
      }`,
    );
    line("Open a new one with --new.");
    return 0;
  }

  let gates = await evaluateGates({ cwd, runId });

  const key = sessionKeyOf(project.projectKey, runId);
  let session: SessionState = loadSession(key);

  const agents = buildAgents();
  const palmer = findBrief("palmer");
  const abortController = new AbortController();
  const startedAt = Date.now();
  let interrupted = false;

  process.on("SIGINT", () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    line(
      "\nInterrupt received. Finishing the stream, then saving the session.",
    );
    abortController.abort();
  });

  const onEvent = (event: CycleEvent): void => {
    if (event.kind === "session") {
      if (session.sessionId === event.sessionId) return;
      session = { ...session, sessionId: event.sessionId };
      saveSession(key, session);
      return;
    }
    if (event.kind === "text") {
      line(event.text);
      return;
    }
    if (event.kind === "tool") {
      line(`  -> ${event.label}`);
      return;
    }
    if (event.kind === "task") {
      line(`  .. ${event.description} started`);
      return;
    }
    line(event.text);
  };

  rule("TEST FORGE");
  line(`Project      ${project.projectKey} (${project.shortName})`);
  line(`Root         ${project.rootPath}`);
  line(`Scope        ${snapshot.run.scope}`);
  line(
    `Run          ${runId} ${
      opened ? `opened, ${focusItems} focus items` : "resumed"
    }`,
  );
  line(`Session      ${session.sessionId ?? "new"}`);
  line(`Subagents    ${Object.keys(agents).length} callsigns loaded`);
  line(
    `Plan         ${
      request.approvePlan
        ? "approved by Captain Lasky"
        : "NOT approved - plan cycle only"
    }`,
  );

  let exit: ExitDecision | null = null;
  let cyclesWithoutPass = 0;

  while (exit === null && !interrupted) {
    const cycle = session.cycles + 1;
    const opening = session.sessionId === null;
    const assignment = planCycle(gates.predicates, gates.workList);
    const prompt = opening
      ? openingPrompt({
          operation: request.operation,
          focus: snapshot.run.focus,
          scope: snapshot.run.scope,
          targets: request.targets,
          runId,
          project,
          cwd,
          approved: request.approvePlan,
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
          },
          gates.predicates,
          assignment,
        );

    rule(`CYCLE ${cycle}`);
    const cycleStartedAt = Date.now();
    const passesBefore = snapshot.passes.length;

    const outcome = await runCycle({
      prompt,
      cwd,
      projectRoot: project.rootPath,
      agents,
      systemPromptAppend: palmer.body,
      resume: session.sessionId,
      abortController,
      onEvent,
    });

    session = {
      ...addUsage(session, outcome.usage, cycle),
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
    line(`Vector       ${vectorLine(gates.predicates)}`);

    if (interrupted) break;

    if (!request.approvePlan && opening) {
      rule("PLAN");
      const plan = outcome.resultText.trim();
      if (plan.length > 0) line(plan);
      line(
        `\nThe plan is Captain Lasky's to approve. Re-run with:\n${resumeHint(
          cwd,
          runId,
        )}`,
      );
      return 0;
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
  }

  if (exit === null) {
    rule("INTERRUPTED");
    line(`Run ${runId} is still open. Resume with:`);
    line(resumeHint(cwd, runId));
    return 130;
  }

  rule(exit.kind);
  line(exit.reason.length > 0 ? exit.reason : "No reason recorded.");

  if (exit.kind === "BLOCKED") {
    line("\nAnswer the question, then resume with:");
    line(resumeHint(cwd, runId));
    return 0;
  }

  if (exit.kind === "STALLED") {
    const board = planCycle(gates.predicates, gates.workList);
    line(
      `Predicates that did not move: ${board.failing
        .map((id) => `${id} ${PREDICATE_NAMES[id]}`)
        .join(", ")}`,
    );
    line(workLines(board.groups));
    return 1;
  }

  const confirmed = snapshot.findings.filter(
    (finding) =>
      finding.status === "confirmed-defect" ||
      finding.status === "confirmed-but-known",
  );
  line(`Units accepted: ${snapshot.unitCounts["accepted"] ?? 0}`);
  line(`Defects confirmed and still red: ${confirmed.length}`);
  for (const finding of confirmed) {
    line(`  - ${finding.findingKey}: ${finding.title}`);
  }
  line(`Waivers signed: ${snapshot.waivers.length}`);
  return 0;
};
