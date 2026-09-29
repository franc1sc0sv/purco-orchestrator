import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { askViaMailbox } from "./mailbox.ts";
import { phaseGate } from "./gates.ts";
import { runForge, type ForgeOutcome } from "./forge.ts";
import { runGrill } from "./grill.ts";
import {
  briefSteps,
  describeStep,
  planSteps,
  stepKey,
  stepLabel,
  type Step,
} from "./plan.ts";
import { Store } from "./store.ts";
import { buildSpikeServer, SPIKE_SERVER_NAME } from "./spike-tools.ts";
import { buildLinearServer, LINEAR_SERVER } from "./linear-tools.ts";
import { PLAYWRIGHT_SERVER } from "./mcp-servers.ts";
import { openPools } from "./postgres-config.ts";
import {
  buildPostgresServer,
  pgServerName,
  type PgTenant,
} from "./postgres-tools.ts";
import type { ReadOnlyPostgres } from "./postgres-tools.ts";
import { MessageBus } from "./bus.ts";
import { EscalationRegistry } from "./escalation.ts";
import { buildHooks } from "./hooks.ts";
import { Lead, type LeadDecision, type LeadDecisionKind, type LeadEvent } from "./lead.ts";
import {
  handleMessage,
  newTotals,
  totalTokens,
  type StreamTotals,
} from "./message-handler.ts";
import {
  buildAgentDefinitions,
  loadPrompt,
  modelFor,
  ROLE_SPECS,
  type PromptVars,
  type RoleSpec,
} from "./roles.ts";
import { AgentScratch } from "./agent-scratch.ts";
import { Journal } from "./journal.ts";
import { Scratchpad } from "./scratchpad.ts";
import { ORCHESTRATOR_LABEL, SubagentTracker } from "./tracker.ts";
import {
  buildOrchestratorServer,
  ORCH_TOOL_NAMES,
  SERVER_NAME,
  type HandoffInput,
} from "./tools.ts";
import { MAX_GATE_REVISIONS, WORKFLOWS, type Workflow } from "./workflows.ts";
import {
  JUDGING_PHASES,
  PHASE_ROLE,
  type HumanItemKind,
  type Phase,
  type PhaseOutcome,
  type RunConfig,
} from "./types.ts";

export const MCP_STARTUP_TIMEOUT_MS = "120000";
export const MCP_TOOL_TIMEOUT_MS = "120000";

export const LEAD_LABEL = "LEAD";

const PURCO_WEB_ROOT = path.join(
  process.env.HOME ?? "",
  "projects/purco-projects/purco-web",
);

const STATE_SCRIPT = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "bin",
  "ticket-state.sh",
);

const BUDGET_WARN_AT = 0.7;

const FORGE_ORCH_TOOLS = ["ask", "escalate", "report", "note"].map(
  (name) => `mcp__${SERVER_NAME}__${name}`,
);

const NO_HUMAN =
  "The human is not available. Record the question in your output as an open decision, state the assumption you proceed under, and continue.";

type GateVerdict =
  | { kind: "approve" }
  | { kind: "stop"; reason: string }
  | { kind: "revise"; notes: string };

const APPROVE = /^\s*(approve|approved|yes|y|ok|go|continue)\b/i;
const STOP = /^\s*stop\b/i;
const RERUN = /^\s*rerun\b\s*(\S+)?/i;

const tagged = (tag: string, body: string): string =>
  body ? `<${tag}>\n${body}\n</${tag}>` : "";

export class Orchestrator {
  private readonly scratchpad: Scratchpad;
  private readonly tracker: SubagentTracker;
  private readonly bus: MessageBus;
  private readonly escalations: EscalationRegistry;
  private readonly outcomes: PhaseOutcome[] = [];
  private readonly scratch: AgentScratch;
  private readonly journal: Journal;
  private readonly handoffs = new Map<string, HandoffInput>();
  private readonly lead: Lead;
  private readonly workflow: Workflow;
  private readonly attempts = new Map<string, number>();
  private readonly reruns = new Map<Phase, number>();
  private readonly leadBacklog: string[] = [];
  private pools: Map<PgTenant, ReadOnlyPostgres> | undefined;
  private aborted = false;
  private stopReason = "";
  private budgetWarned = false;
  private leadCost = 0;
  private readonly store: Store | undefined;
  private currentCluster = "";
  private currentKey = "run";

  private readonly config: RunConfig;

  constructor(config: RunConfig) {
    this.config = config;
    this.workflow = WORKFLOWS[config.workflow];
    this.scratchpad = new Scratchpad(
      config.runDir,
      config.runId,
      config.ticket,
    );
    this.store = config.mailboxDb
      ? new Store(config.mailboxDb, config.runId)
      : undefined;
    this.scratch = new AgentScratch(config.runDir);
    this.journal = new Journal(config.runDir, config.runId, config.worktree);
    this.tracker = new SubagentTracker(this.scratchpad);
    this.bus = new MessageBus(this.scratchpad, config.runDir);
    this.escalations = new EscalationRegistry(this.scratchpad, config.runDir, {
      askOrchestrator: (question, context) => this.leadAnswer(question, context),
      askHuman: (question) => this.askHuman(question),
    });
    const sessionFile = path.join(config.runDir, "lead-session.txt");
    this.lead = new Lead({
      systemPrompt: loadPrompt("lead", this.promptVars({ AGENT: LEAD_LABEL })),
      cwd: config.worktree,
      additionalDirectories: [config.contextPack],
      env: this.agentEnv(),
      model: config.modelOverride,
      loadSession: () =>
        this.store?.leadSession() ??
        (fs.existsSync(sessionFile)
          ? fs.readFileSync(sessionFile, "utf8").trim() || undefined
          : undefined),
      saveSession: (id) => {
        this.store?.setLeadSession(id);
        fs.mkdirSync(config.runDir, { recursive: true });
        fs.writeFileSync(sessionFile, id);
      },
      onCost: (usd) => {
        this.leadCost = usd;
      },
    });
  }

  private agentEnv(): Record<string, string | undefined> {
    return {
      ...process.env,
      CLAUDE_CONFIG_DIR: this.config.configDir,
      MCP_TIMEOUT: MCP_STARTUP_TIMEOUT_MS,
      MCP_TOOL_TIMEOUT: MCP_TOOL_TIMEOUT_MS,
    };
  }

  private promptVars(overrides: Partial<PromptVars> = {}): PromptVars {
    return {
      AGENT: ORCHESTRATOR_LABEL,
      WORKFLOW: this.config.workflow,
      TICKET: this.config.ticket,
      WORKTREE: this.config.worktree,
      PACK: this.config.contextPack,
      BASE: "dev",
      BRIEF: "",
      ...overrides,
    };
  }

  private record(summary: string, kind: "note" | "escalation" | "answer" = "note", data?: Record<string, unknown>): void {
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      this.tracker.currentPhase(),
      kind,
      summary,
      data,
    );
  }

  private snapshotDecisions(key: string): void {
    const file = path.join(this.config.contextPack, "03-decisions.md");
    if (!fs.existsSync(file)) return;
    try {
      fs.copyFileSync(
        file,
        path.join(
          this.config.runDir,
          `03-decisions.before-${key.replace(/[^\w.-]+/g, "_")}.md`,
        ),
      );
    } catch {
      this.record("could not snapshot 03-decisions.md");
    }
  }

  private async leadDecide(event: LeadEvent): Promise<LeadDecision> {
    const backlog = this.leadBacklog.splice(0);
    const body = backlog.length
      ? `${tagged("since_last_event", backlog.join("\n"))}\n\n${event.body}`
      : event.body;
    const decision = await this.lead.decide({ ...event, body });
    this.scratchpad.record(
      LEAD_LABEL,
      this.tracker.currentPhase(),
      "answer",
      `lead ${event.kind} -> ${decision.decision}: ${decision.text.slice(0, 200)}`,
      { event: event.kind, decision },
    );
    return decision;
  }

  private async leadAnswer(question: string, context: string): Promise<string> {
    if (this.config.askHuman) return this.askHuman(question);
    const phase = this.tracker.currentPhase();
    const judging = phase !== "run" && JUDGING_PHASES.includes(phase);
    const decision = await this.leadDecide({
      kind: "question",
      allowed: ["answer"],
      body: [
        `Worker: ${this.tracker.active()}`,
        `Role: ${phase === "run" ? "-" : PHASE_ROLE[phase]}${judging ? " (judging role)" : ""}`,
        `Step: ${this.currentKey}`,
        "",
        question,
        context ? `\nContext from the worker:\n${context}` : "",
      ].join("\n"),
    });
    if (decision.decision === "defer") return this.askHuman(decision.text);
    return decision.text;
  }

  private async humanRaw(
    kind: HumanItemKind,
    text: string,
  ): Promise<string | undefined> {
    const questionFile = path.join(this.config.runDir, "human-questions.md");
    fs.appendFileSync(
      questionFile,
      `\n## ${new Date().toISOString()} (${kind})\n\n${text}\n`,
    );
    this.record(`${kind} for the human: ${text.slice(0, 300)}`, "note", {
      kind,
      questionFile,
    });

    if (this.config.mailboxDb) {
      process.stderr.write(
        `\n${"=".repeat(72)}\n${kind.toUpperCase()} — posted to the mailbox, waiting\n${text}\n${"=".repeat(72)}\n`,
      );
      const posted = await askViaMailbox({
        dbPath: this.config.mailboxDb,
        runId: this.config.runId,
        kind,
        question: text,
        fromAgent: this.tracker.active(),
        phase: this.currentKey,
        onPost: (id) => this.record(`mailbox ${kind} ${id} awaiting an answer`, "note", { questionId: id }),
      });
      const answer = posted.answer?.trim();
      this.record(
        answer ? `human via mailbox: ${answer}` : "mailbox timed out",
        "answer",
        { questionId: posted.id },
      );
      return answer || undefined;
    }

    if (this.config.nonInteractive) return undefined;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    process.stderr.write(
      `\n${"=".repeat(72)}\n${kind.toUpperCase()}\n${text}\n${"=".repeat(72)}\n`,
    );
    const reply = (await rl.question("> ")).trim();
    rl.close();
    this.record(`human: ${reply}`, "answer");
    return reply || undefined;
  }

  private async askHuman(question: string): Promise<string> {
    return (await this.humanRaw("question", question)) ?? NO_HUMAN;
  }

  private recordPhaseState(
    phase: Phase,
    status: string,
    note: string,
    agent: string,
  ): void {
    if (!fs.existsSync(STATE_SCRIPT)) return;
    try {
      execFileSync(STATE_SCRIPT, ["set", phase, status, note.slice(0, 120)], {
        cwd: this.config.worktree,
        env: { ...process.env, TICKET_CTX: `agent:${agent}` },
        stdio: "ignore",
      });
    } catch {
      this.record(`could not record phase state for ${phase}`);
    }
  }

  private resolvePath(candidate: string): string {
    if (path.isAbsolute(candidate)) return candidate;
    const inPack = path.join(this.config.contextPack, candidate);
    if (fs.existsSync(inPack)) return inPack;
    return path.join(this.config.worktree, candidate);
  }

  private clusterBrief(step: Step): string {
    if (!step.cluster) return "";
    return [
      `Your cluster is **${step.cluster}**.`,
      `It holds ${step.rows} sites that need a judgement, ${step.writers} of which mutate data.`,
      "Call `worklist` to get them. That list is the whole of your job; do not look for work outside it.",
    ].join(" ");
  }

  private taskFor(step: Step): string {
    const phase = step.phase;
    const pack = this.config.contextPack;
    const ticket = this.config.ticket;
    const common = `Your context pack is ${pack}.`;
    switch (phase) {
      case "survey":
        return step.cluster
          ? `Survey cluster ${step.cluster} for ${ticket}. Call worklist, judge every site, triage every one, and call finish. ${common}`
          : "No cluster was assigned. Escalate at level orchestrator rather than surveying anything.";
      case "audit":
        return `Audit every finding with status "found" for ${ticket}. Re-derive each claim from the code and reject what you cannot reproduce. ${common}`;
      case "synthesize":
        return `Write the spike report for ${ticket} into ${pack}. Read the verified findings with the findings tool, then follow your prompt's file list. ${common}`;
      case "intake":
        return `Run intake for ${ticket}. Write ${pack}/01-ticket-and-context.md. ${common}`;
      case "grill":
        return `Find every decision ${ticket} leaves open, from ${pack}/01-ticket-and-context.md and the code it names. Write ${pack}/02a-open-questions.md and ${pack}/02a-open-questions.json. Look up every fact yourself and ask nothing. ${common}`;
      case "plan":
        return `Plan ${ticket} from ${pack}/01-ticket-and-context.md, with ${pack}/03-decisions.md binding. Write ${pack}/02-plan.md and one brief per slice, and append only to ${pack}/03-decisions.md. ${common}`;
      case "build":
        if (!step.brief) {
          return `No brief files exist in ${pack}. Escalate at level orchestrator rather than inventing one.`;
        }
        return step.fix
          ? `Fix the defects handed to you below, inside the scope of ${step.brief}. Change nothing the defects do not require. Run yarn tsc when you believe you are done. ${common}`
          : `Implement ${step.brief}. Run yarn tsc when you believe you are done. ${common}`;
      case "static":
        return `Run yarn static in ${this.config.worktree} and fix only what the change on this branch broke. Report anything else. ${common}`;
      case "test":
        return `Write and run usecase-level integration tests for the change on this branch. Report each implementation defect with report, for_role "builder", and include the failing assertion. Write ${pack}/05-test-notes.md. ${common}`;
      case "verify":
        return `Verify the change in the live application. Report each broken flow with report, for_role "builder", and include what you saw. Write ${pack}/06-verification.md. ${common}`;
      case "review":
        return `Review the diff against origin/dev for ${ticket}. Report each in-scope defect that the builder must fix with report, for_role "builder". Write ${pack}/07-review-findings.md. ${common}`;
      default:
        return `Run phase ${phase} as ${PHASE_ROLE[phase]}. ${common}`;
    }
  }

  private briefFiles(): string[] {
    if (!fs.existsSync(this.config.contextPack)) return [];
    return fs
      .readdirSync(this.config.contextPack)
      .filter((f) => /^04-brief-.*\.md$/.test(f))
      .sort()
      .map((f) => path.join(this.config.contextPack, f));
  }

  private briefFor(target: string | undefined): string | undefined {
    if (!target) return undefined;
    const wanted = path.basename(target).replace(/\.md$/, "");
    return this.briefFiles().find((file) => {
      const name = path.basename(file, ".md");
      return name === wanted || name === `04-brief-${wanted}`;
    });
  }

  private async pgPools(): Promise<Map<PgTenant, ReadOnlyPostgres>> {
    if (this.pools === undefined) {
      const { pools, notes } = await openPools(PURCO_WEB_ROOT);
      this.pools = pools;
      for (const note of notes) this.record(`postgres ${note}`);
    }
    return this.pools;
  }

  private async serversFor(
    spec: RoleSpec,
    orchServer: McpServerConfig,
    key: string,
  ): Promise<Record<string, McpServerConfig>> {
    const servers: Record<string, McpServerConfig> = {
      [SERVER_NAME]: orchServer,
    };
    if (spec.needsLinear) {
      servers[LINEAR_SERVER] = buildLinearServer();
    }
    if (spec.needsBrowser) {
      servers.playwright = PLAYWRIGHT_SERVER;
    }
    if (spec.needsPostgres) {
      for (const [tenant, db] of await this.pgPools()) {
        servers[pgServerName(tenant)] = buildPostgresServer(db);
      }
    }
    if (spec.needsSpike && this.store) {
      servers[SPIKE_SERVER_NAME] = buildSpikeServer({
        store: this.store,
        scratchpad: this.scratchpad,
        currentPhase: () => this.tracker.currentPhase(),
        activeAgent: () => this.tracker.active(),
        activeCluster: () => this.currentCluster,
        recordHandoff: (agent, summary, outputPath) => {
          this.handoffs.set(`${key}:${agent}`, {
            summary,
            outputPath,
            produced: outputPath ? [outputPath] : [],
            openQuestions: 0,
            status: "delivered",
          });
        },
      });
    }
    return servers;
  }

  private async runPhase(step: Step): Promise<PhaseOutcome> {
    const phase = step.phase;
    const role = PHASE_ROLE[phase];
    const spec = ROLE_SPECS[role];
    const label = stepLabel(role, step);
    const key = stepKey(step);
    this.currentKey = key;
    this.currentCluster = step.cluster ?? "";
    this.tracker.setPhase(phase);
    this.tracker.setMainLabel(label);
    this.snapshotDecisions(key);
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      phase,
      "phase_start",
      `delegating ${describeStep(step)} to ${label}`,
    );
    this.recordPhaseState(phase, "in-progress", `${role} started`, ORCHESTRATOR_LABEL);

    const handed = this.bus.relay(role, label, phase);
    const briefing = this.bus.briefing(handed);

    const vars = this.promptVars({
      AGENT: label,
      BRIEF: step.brief ?? this.clusterBrief(step),
    });
    const agents = buildAgentDefinitions(vars, [role], this.config.modelOverride);
    const model = modelFor(spec, this.config.modelOverride);
    const totals: StreamTotals = newTotals();
    const task = this.taskFor(step);
    this.journal.start(key, task);
    const resumeNote = this.journal.resumeNote(key);

    const server = buildOrchestratorServer({
      scratchpad: this.scratchpad,
      bus: this.bus,
      escalations: this.escalations,
      scratch: this.scratch,
      currentPhase: () => this.tracker.currentPhase(),
      currentRole: () => role,
      activeAgent: () => this.tracker.active(),
      resolvePath: (candidate) => this.resolvePath(candidate),
      recordHandoff: (agent, handoff) => {
        this.handoffs.set(`${key}:${agent}`, handoff);
      },
    });

    const writeMode = spec.writes && this.config.autoApproveWrites;

    try {
      for await (const message of query({
        prompt: [
          task,
          tagged("defects_to_fix", step.fix ?? ""),
          tagged("handed_messages", briefing),
          tagged("human_notes", step.notes ?? ""),
          tagged("resume_note", resumeNote),
        ]
          .filter((part) => part.length > 0)
          .join("\n\n"),
        options: {
          agent: role,
          agents,
          model,
          cwd: this.config.worktree,
          additionalDirectories: [this.config.contextPack],
          settingSources: ["project"],
          mcpServers: await this.serversFor(spec, server, key),
          env: this.agentEnv(),
          allowedTools: [...spec.tools, ...ORCH_TOOL_NAMES],
          permissionMode: writeMode ? "acceptEdits" : "default",
          hooks: buildHooks({
            scratchpad: this.scratchpad,
            tracker: this.tracker,
            recordFileWritten: (file) => this.journal.recordFile(key, file),
          }),
          forwardSubagentText: true,
          includePartialMessages: false,
          maxTurns: Math.min(spec.maxTurns, this.config.maxTurnsPerPhase),
          effort: spec.effort,
        },
      })) {
        handleMessage(
          message,
          { scratchpad: this.scratchpad, tracker: this.tracker },
          totals,
        );
      }
    } catch (error) {
      totals.errors.push(String(error));
    }

    this.tracker.setMainLabel(ORCHESTRATOR_LABEL);

    if (totals.refusal) {
      await this.escalations.raise({
        from: label,
        phase,
        level: "abort",
        summary: `${role} was refused by the model on turn ${totals.turns}`,
        detail: totals.refusal,
        blocker:
          "The step produced no work. Reword the role prompt, or run the step in a fresh session, before retrying.",
      });
    }

    const handoff = this.handoffs.get(`${key}:${label}`);
    const phaseEscalations = this.escalations.forPhase(phase);
    const hardStop = phaseEscalations.some((e) => e.level === "abort");
    const failed =
      totals.errors.length > 0 ||
      totals.subtype !== "success" ||
      totals.refusal !== undefined;
    const delivered = handoff?.status === "delivered";

    const outcome: PhaseOutcome = {
      phase,
      agent: label,
      status: hardStop ? "failed" : failed || !delivered ? "escalated" : "done",
      summary: handoff
        ? `${handoff.status}: ${handoff.summary}${handoff.evidence ? ` (evidence: ${handoff.evidence})` : ""}`
        : `no handoff recorded. ${totals.result?.slice(0, 500) ?? ""}`.trim(),
      outputPath: handoff?.outputPath,
      sessionId: totals.sessionId,
      costUsd: totals.costUsd,
      turns: totals.turns,
      tokens: totals.usage,
      model,
      escalations: phaseEscalations.map((e) => e.id),
      errors: totals.errors,
    };
    this.outcomes.push(outcome);

    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      phase,
      "phase_end",
      `${key} ${outcome.status} — $${outcome.costUsd.toFixed(4)}, ${outcome.turns} turns, ${totalTokens(outcome.tokens)} tokens on ${model}`,
      { outcome },
    );
    this.recordPhaseState(
      phase,
      outcome.status === "done" ? "done" : "in-progress",
      outcome.summary,
      label,
    );
    this.scratchpad.writeLive();
    this.journal.end(key, outcome.status === "done" ? "done" : "interrupted");

    if (hardStop) this.stop(`${key} raised an abort`);
    return outcome;
  }

  private async runTestStep(step: Step): Promise<PhaseOutcome> {
    const key = stepKey(step);
    const label = step.attempt && step.attempt > 1 ? `TEST-FORGE#${step.attempt}` : "TEST-FORGE";
    this.currentKey = key;
    this.tracker.setPhase(step.phase);
    this.tracker.setMainLabel(label);
    this.scratchpad.record(ORCHESTRATOR_LABEL, step.phase, "phase_start", `delegating ${key} to Test Forge`);
    this.recordPhaseState(step.phase, "in-progress", "test forge started", ORCHESTRATOR_LABEL);

    const server = buildOrchestratorServer({
      scratchpad: this.scratchpad,
      bus: this.bus,
      escalations: this.escalations,
      scratch: this.scratch,
      currentPhase: () => this.tracker.currentPhase(),
      currentRole: () => "tester",
      activeAgent: () => this.tracker.active(),
      resolvePath: (candidate) => this.resolvePath(candidate),
      recordHandoff: () => {},
    });

    let forge: ForgeOutcome;
    try {
      forge = await runForge({
        worktree: this.config.worktree,
        pack: this.config.contextPack,
        runDir: this.config.runDir,
        ticket: this.config.ticket,
        base: "dev",
        scope: this.config.testScope,
        targets: this.config.testTargets,
        focus: step.fix ? `Confirm the fixes for:\n${step.fix}` : this.config.testFocus,
        fresh: Boolean(step.attempt && step.attempt > 1),
        askHuman: (kind, text) => this.humanRaw(kind, text),
        orchServer: server,
        orchTools: FORGE_ORCH_TOOLS,
        env: this.agentEnv(),
      });
    } catch (error) {
      this.tracker.setMainLabel(ORCHESTRATOR_LABEL);
      this.record(`test forge failed to run: ${String(error)}`, "escalation");
      return this.recordForgeOutcome(step, label, "escalated", `Test Forge failed to run: ${String(error)}`, 0, [String(error)]);
    }
    this.tracker.setMainLabel(ORCHESTRATOR_LABEL);

    if (forge.result.refusal && this.config.workflow === "ticket") {
      this.record(`test forge refused (${forge.result.refusal}); the tester worker runs instead`, "escalation");
      return this.runPhase(step);
    }

    for (const defect of forge.defects) {
      this.bus.report({
        from: label,
        subject: `[finding] ${defect.title}`,
        body: `Test Forge confirmed a defect in the production code: ${defect.findingKey}. The test stays red on purpose until the code is fixed. The operation log is ${forge.logFile}.`,
        forRole: "builder",
        phase: step.phase,
      });
    }

    const exit = forge.result.exit;
    const done = exit?.kind === "DONE";
    const summary = forge.result.refusal
      ? `refused: ${forge.result.refusal}`
      : `Test Forge run ${forge.result.runId ?? "-"} (${forge.scope}) ${exit?.kind ?? "INTERRUPTED"}: ${exit?.reason ?? "no exit recorded"}. ${forge.defects.length} confirmed defect(s) for the builder.`;
    return this.recordForgeOutcome(step, label, done ? "done" : "escalated", summary, forge.result.costUsd, []);
  }

  private recordForgeOutcome(
    step: Step,
    label: string,
    status: PhaseOutcome["status"],
    summary: string,
    costUsd: number,
    errors: string[],
  ): PhaseOutcome {
    const outcome: PhaseOutcome = {
      phase: step.phase,
      agent: label,
      status,
      summary,
      costUsd,
      turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      model: "test-forge",
      escalations: this.escalations.forPhase(step.phase).map((e) => e.id),
      errors,
    };
    this.outcomes.push(outcome);
    this.scratchpad.record(ORCHESTRATOR_LABEL, step.phase, "phase_end", `${stepKey(step)} ${status} — ${summary}`, { outcome });
    this.recordPhaseState(step.phase, status === "done" ? "done" : "in-progress", summary, label);
    this.scratchpad.writeLive();
    return outcome;
  }

  private async grill(step: Step): Promise<PhaseOutcome> {
    const key = stepKey(step);
    this.currentKey = key;
    this.tracker.setPhase(step.phase);
    const result = await runGrill({
      pack: this.config.contextPack,
      ask: (text) => this.humanRaw("question", text),
      prune: async (answered, answer, remaining) => {
        const decision = await this.leadDecide({
          kind: "grill_answer",
          allowed: ["answer"],
          body: JSON.stringify({ answered, answer, remaining }, null, 2),
        });
        return decision.decision === "answer"
          ? { settled: decision.settled ?? [], reason: decision.text }
          : { settled: [], reason: "" };
      },
    });
    const summary = result
      ? `grill: ${result.answered} answered, ${result.parked} parked, ${result.assumed} assumed, ${result.settledByLead} settled by an earlier answer`
      : "grill: 02a-open-questions.json is missing or unreadable";
    const outcome: PhaseOutcome = {
      phase: step.phase,
      agent: "HUMAN",
      status: result ? "done" : "escalated",
      summary,
      costUsd: 0,
      turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      escalations: [],
      errors: [],
    };
    this.outcomes.push(outcome);
    this.scratchpad.record(ORCHESTRATOR_LABEL, step.phase, "phase_end", `${key} ${outcome.status} — ${summary}`);
    return outcome;
  }

  private async gate(step: Step, outcome: PhaseOutcome): Promise<GateVerdict> {
    const key = stepKey(step);
    const card = await this.leadDecide({
      kind: "gate_card",
      allowed: ["answer"],
      body: [
        `Step: ${key}`,
        `Output: ${outcome.outputPath ?? "-"}`,
        `Handoff: ${outcome.summary}`,
      ].join("\n"),
    });
    const text = card.decision === "answer" ? card.text : outcome.summary;
    const gatesDir = path.join(this.config.runDir, "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    const cardFile = path.join(gatesDir, `${key.replace(/[^\w.-]+/g, "_")}.md`);
    fs.writeFileSync(cardFile, text);

    const answer = await this.humanRaw(
      "gate",
      `${text}\n\n---\nReply "approve" to continue, "stop" to end the run here, or write what must change and ${key} runs again with your notes.`,
    );
    if (!answer) return { kind: "stop", reason: `no answer at the ${key} gate; the card is in ${cardFile}` };
    if (APPROVE.test(answer)) return { kind: "approve" };
    if (STOP.test(answer)) return { kind: "stop", reason: `the human stopped the run at the ${key} gate` };
    if ((step.attempt ?? 1) >= MAX_GATE_REVISIONS) {
      return { kind: "stop", reason: `${key} reached ${MAX_GATE_REVISIONS} revisions at its gate` };
    }
    return { kind: "revise", notes: answer };
  }

  private nextAttempt(step: Step): number {
    const base = stepKey({ ...step, attempt: undefined });
    const next = (this.attempts.get(base) ?? step.attempt ?? 1) + 1;
    this.attempts.set(base, next);
    return next;
  }

  private async humanStepDecision(
    key: string,
    reason: string,
    allowed: LeadDecisionKind[],
  ): Promise<LeadDecision> {
    const choices = allowed.includes("rerun")
      ? '"continue", "stop", or "rerun <brief file>"'
      : '"continue" or "stop"';
    const answer = await this.humanRaw(
      "question",
      `${reason}\n\nStep ${key} needs a decision. Reply ${choices}.`,
    );
    if (!answer || STOP.test(answer)) {
      return { decision: "stop", text: answer ? "the human stopped the run" : `no answer after ${key}` };
    }
    const rerun = RERUN.exec(answer);
    if (rerun && allowed.includes("rerun")) {
      return { decision: "rerun", text: answer, target: rerun[1] };
    }
    return { decision: "continue", text: answer };
  }

  private async afterStep(step: Step, outcome: PhaseOutcome, queue: Step[]): Promise<void> {
    const key = stepKey(step);
    const judged = this.workflow.judged.includes(step.phase);
    const forBuilder = this.bus.pendingFor("builder");
    if (!judged && outcome.status === "done") {
      this.leadBacklog.push(`${key} done: ${outcome.summary.slice(0, 300)}`);
      return;
    }
    if (judged && outcome.status === "done" && forBuilder.length === 0) {
      this.leadBacklog.push(`${key} done with no defect for the builder: ${outcome.summary.slice(0, 300)}`);
      return;
    }

    const used = this.reruns.get(step.phase) ?? 0;
    const canRerun = judged && used < this.workflow.maxReruns;
    const allowed: LeadDecisionKind[] = canRerun
      ? ["continue", "rerun", "stop"]
      : ["continue", "stop"];
    let decision = await this.leadDecide({
      kind: "step_end",
      allowed,
      body: [
        `Step: ${key}`,
        `Status: ${outcome.status}`,
        `Handoff: ${outcome.summary}`,
        outcome.errors.length ? `Errors: ${outcome.errors.join(" | ").slice(0, 600)}` : "",
        forBuilder.length ? tagged("reports_for_builder", this.bus.briefing(forBuilder)) : "",
        judged ? `Briefs: ${this.briefFiles().map((file) => path.basename(file)).join(", ") || "none"}` : "",
        judged ? `Reruns used for ${step.phase}: ${used} of ${this.workflow.maxReruns}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (decision.decision === "defer") {
      decision = await this.humanStepDecision(key, decision.text, allowed);
    }

    if (decision.decision === "stop") {
      this.stop(`stopped after ${key}: ${decision.text}`);
      return;
    }
    if (decision.decision !== "rerun") return;

    const brief = this.briefFor(decision.target);
    if (!brief || !canRerun) {
      this.record(
        `rerun refused after ${key}: ${brief ? "the rerun limit is reached" : `no brief matches "${decision.target ?? ""}"`}`,
        "escalation",
      );
      const human = await this.humanStepDecision(
        key,
        `The lead asked to rerun the builder, but ${brief ? "the rerun limit is reached" : "it named no existing brief"}. The defects are in the reports for the builder.`,
        ["continue", "stop"],
      );
      if (human.decision === "stop") this.stop(`stopped after ${key}: ${human.text}`);
      return;
    }

    this.reruns.set(step.phase, used + 1);
    const build: Step = { phase: "build", brief, fix: decision.text };
    build.attempt = this.nextAttempt(build);
    const judge: Step = {
      ...step,
      notes: undefined,
      fix: step.phase === "test" ? decision.text : undefined,
    };
    judge.attempt = this.nextAttempt(step);
    queue.unshift(build, judge);
    this.record(`rerun: ${stepKey(build)} then ${stepKey(judge)}`, "note", { reason: decision.text });
  }

  private stop(reason: string): void {
    if (this.aborted) return;
    this.aborted = true;
    this.stopReason = reason;
    this.record(`run stopped: ${reason}`, "escalation");
  }

  private skipStep(step: Step, why: string): void {
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      step.phase,
      "phase_end",
      `${describeStep(step)} skipped — ${why}`,
    );
    this.outcomes.push({
      phase: step.phase,
      agent: "-",
      status: "skipped",
      summary: why,
      costUsd: 0,
      turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      escalations: [],
      errors: [],
    });
  }

  private spentSoFar(): number {
    const phases = this.store
      ? this.store.phases().reduce((sum, phase) => sum + (phase.costUsd ?? 0), 0)
      : this.outcomes.reduce((sum, o) => sum + o.costUsd, 0);
    return phases + this.leadCost;
  }

  private checkBudget(): void {
    const budget = this.config.budgetUsd;
    if (!budget || budget <= 0) return;
    const spent = this.spentSoFar();
    if (spent >= budget) {
      this.stop(`budget spent: $${spent.toFixed(4)} of $${budget.toFixed(2)}`);
      return;
    }
    if (spent >= budget * BUDGET_WARN_AT && !this.budgetWarned) {
      this.budgetWarned = true;
      this.record(`budget warning: $${spent.toFixed(4)} of $${budget.toFixed(2)} spent`, "note", { spent, budget });
    }
  }

  private recordPhaseRow(index: number, key: string): void {
    const outcome = this.outcomes[index];
    if (!outcome || !this.store) return;
    this.store.endPhase({
      phase: key,
      status: outcome.status,
      summary: outcome.summary,
      costUsd: outcome.costUsd,
      turns: outcome.turns,
      tokensIn: outcome.tokens.input,
      tokensOut: outcome.tokens.output,
      tokensCacheRead: outcome.tokens.cacheRead,
      tokensCacheWrite: outcome.tokens.cacheCreation,
      model: outcome.model,
    });
  }

  async run(): Promise<PhaseOutcome[]> {
    this.store?.startRun(this.config.ticket);
    this.record(
      `${this.config.ticket} — ${this.config.workflow} workflow, phases ${this.config.phases.join(" > ")}`,
      "note",
      { config: { ...this.config } },
    );
    this.escalations.persist();
    this.bus.persist();

    if (this.config.resume) this.journal.markInterrupted();
    const done = this.config.resume
      ? new Set(this.store?.completedPhases() ?? [])
      : new Set<string>();
    if (done.size > 0) this.record(`resume: skipping ${[...done].join(", ")}`, "note", { skipped: [...done] });

    const queue = planSteps(this.config.phases, this.store);
    this.record(`plan: ${queue.map(describeStep).join(" > ")}`, "note", { steps: queue });

    const gated = new Set<Phase>();
    while (queue.length > 0) {
      const step = queue.shift() as Step;
      if (step.phase === "build" && !step.brief) {
        const briefs = this.briefFiles();
        if (briefs.length > 0) {
          queue.unshift(...briefSteps(briefs));
          this.record(`build expands to ${briefs.length} brief step(s)`);
          continue;
        }
      }

      const key = stepKey(step);
      if (done.has(key)) continue;

      const index = this.outcomes.length;
      this.store?.startPhase(key, step.human ? "HUMAN" : stepLabel(PHASE_ROLE[step.phase], step));
      if (this.aborted) {
        this.skipStep(step, `run stopped before this step: ${this.stopReason}`);
        this.recordPhaseRow(index, key);
        continue;
      }

      if (this.store && !step.human && !gated.has(step.phase)) {
        gated.add(step.phase);
        const gate = phaseGate(step.phase, this.store, this.config.contextPack);
        if (!gate.ok) {
          this.skipStep(step, `gate refused: ${gate.reason}`);
          this.recordPhaseRow(index, key);
          this.stop(`gate refused ${step.phase}: ${gate.reason}`);
          continue;
        }
        this.record(`gate open for ${step.phase}: ${gate.reason}`);
      }

      const outcome = step.human
        ? await this.grill(step)
        : step.phase === "test"
          ? await this.runTestStep(step)
          : await this.runPhase(step);
      this.recordPhaseRow(index, key);
      this.checkBudget();
      if (this.aborted) continue;

      if (this.workflow.gatesAfter.includes(step.phase) && outcome.status === "done") {
        const verdict = await this.gate(step, outcome);
        if (verdict.kind === "stop") {
          this.stop(verdict.reason);
          continue;
        }
        if (verdict.kind === "revise") {
          queue.unshift({ ...step, notes: verdict.notes, attempt: this.nextAttempt(step) });
          continue;
        }
      }

      if (!step.human) await this.afterStep(step, outcome, queue);
    }

    const totalCost = this.outcomes.reduce((sum, o) => sum + o.costUsd, 0) + this.leadCost;
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      "run",
      "run_end",
      `run ${this.aborted ? `STOPPED (${this.stopReason})` : "complete"} — $${totalCost.toFixed(4)} across ${this.outcomes.length} steps`,
      { outcomes: this.outcomes, stopReason: this.stopReason },
    );
    try {
      this.writeReport(totalCost);
    } catch (error) {
      this.record(`could not write report.md: ${String(error)}`);
    }
    this.store?.endRun(this.aborted ? "stopped" : "complete");
    if (this.pools) {
      for (const db of this.pools.values()) await db.close();
    }
    await this.scratchpad.close();
    return this.outcomes;
  }

  private writeReport(totalCost: number): void {
    const lines = [
      `# Run report — ${this.config.ticket}`,
      "",
      `Run ${this.config.runId} · ${this.config.workflow} · $${totalCost.toFixed(4)} · ${this.aborted ? `STOPPED: ${this.stopReason}` : "complete"}`,
      "",
      `Lead session ${this.lead.session() ?? "-"} · lead cost $${this.leadCost.toFixed(4)}`,
      "",
      "## Steps",
      "",
      "| Phase | Agent | Model | Status | Cost | Turns | In | Out | Cache read | Cache write | Output |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...this.outcomes.map(
        (o) =>
          `| ${o.phase} | ${o.agent} | ${o.model ?? "-"} | ${o.status} | $${o.costUsd.toFixed(4)} | ${o.turns} | ${o.tokens.input} | ${o.tokens.output} | ${o.tokens.cacheRead} | ${o.tokens.cacheCreation} | ${o.outputPath ? path.basename(o.outputPath) : "-"} |`,
      ),
      "",
      `Total tokens: ${this.outcomes.reduce((sum, o) => sum + totalTokens(o.tokens), 0)}` +
        (this.config.budgetUsd
          ? ` · budget $${this.config.budgetUsd.toFixed(2)}, spent $${totalCost.toFixed(4)}`
          : ""),
      "",
      "## Handoffs",
      "",
      ...this.outcomes.map((o) => `### ${o.phase} (${o.agent})\n\n${o.summary}\n`),
      "## Escalations",
      "",
    ];
    const all = this.escalations.records();
    if (all.length === 0) lines.push("None.", "");
    for (const e of all) {
      lines.push(
        `- **${e.id}** ${e.level} from ${e.from} (${e.phase}) — ${e.summary}`,
        `  - resolved by ${e.resolvedBy ?? "unresolved"}: ${e.resolution ?? "—"}`,
      );
    }
    lines.push("", "## Agents", "");
    for (const session of this.tracker.sessions()) {
      lines.push(
        `- ${session.label} (${session.agentType}) — ${session.toolCalls} tool calls, ${session.failures} failures`,
      );
    }
    lines.push(
      "",
      "## Messages",
      "",
      ...this.bus.all().map((m) => `- ${m.id} ${m.from} -> ${m.forRole ?? m.to}: ${m.subject}`),
    );
    fs.writeFileSync(path.join(this.config.runDir, "report.md"), lines.join("\n"));
  }
}
