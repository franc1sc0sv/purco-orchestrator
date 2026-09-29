import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { askViaMailbox } from "./mailbox.ts";
import { phaseGate } from "./gates.ts";
import { describeStep, planSteps, stepLabel, type Step } from "./plan.ts";
import { Store } from "./store.ts";
import { buildSpikeServer, SPIKE_SERVER_NAME } from "./spike-tools.ts";
import { execFileSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
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
import {
  MODELS,
  PHASE_ROLE,
  type Phase,
  type PhaseOutcome,
  type RunConfig,
} from "./types.ts";

export const MCP_STARTUP_TIMEOUT_MS = "120000";
export const MCP_TOOL_TIMEOUT_MS = "120000";

const PURCO_WEB_ROOT = path.join(
  process.env.HOME ?? "",
  "projects/purco-projects/purco-web",
);

const BUDGET_WARN_AT = 0.7;

const ARBITER_DIGEST_LINES = 15;

const ARBITER_CONTRACT = [
  "## Your answer",
  "",
  "Reply with one JSON object and nothing else:",
  "",
  '{ "decision": "answer" | "defer", "text": "<the decision, or the question to put to the human>", "confidence": "high" | "low" }',
  "",
  'Use "defer" when only the human can decide. Use "answer" otherwise.',
].join("\n");

export type ArbiterVerdict = {
  decision: "answer" | "defer";
  text: string;
  confidence: "high" | "low";
};

export const parseArbiterVerdict = (raw: string): ArbiterVerdict => {
  const fallback: ArbiterVerdict = {
    decision: /^\s*DEFER TO HUMAN/i.test(raw) ? "defer" : "answer",
    text: raw.replace(/^\s*DEFER TO HUMAN\s*/i, "").trim(),
    confidence: "low",
  };
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return fallback;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const decision = parsed.decision === "defer" ? "defer" : "answer";
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (text.length === 0) return fallback;
    return {
      decision,
      text,
      confidence: parsed.confidence === "high" ? "high" : "low",
    };
  } catch {
    return fallback;
  }
};

const STATE_SCRIPT = path.join(
  process.env.HOME ?? "",
  ".claude-work/skills/purco-ticket/scripts/ticket-state.sh",
);

export class Orchestrator {
  private readonly scratchpad: Scratchpad;
  private readonly tracker: SubagentTracker;
  private readonly bus: MessageBus;
  private readonly escalations: EscalationRegistry;
  private readonly outcomes: PhaseOutcome[] = [];
  private readonly scratch: AgentScratch;
  private readonly journal: Journal;
  private readonly handoffs = new Map<string, HandoffInput>();
  private pools: Map<PgTenant, ReadOnlyPostgres> | undefined;
  private aborted = false;
  private budgetWarned = false;
  private readonly store: Store | undefined;
  private currentCluster = "";

  private readonly config: RunConfig;

  constructor(config: RunConfig) {
    this.config = config;
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
      askOrchestrator: (question, context) => this.arbitrate(question, context),
      askHuman: (question) => this.askHuman(question),
    });
  }

  private promptVars(overrides: Partial<PromptVars> = {}): PromptVars {
    return {
      AGENT: ORCHESTRATOR_LABEL,
      TICKET: this.config.ticket,
      WORKTREE: this.config.worktree,
      PACK: this.config.contextPack,
      BASE: "dev",
      BRIEF: "",
      ...overrides,
    };
  }

  private humanDecisions(): string {
    const file = path.join(this.config.contextPack, "03-decisions.md");
    if (!fs.existsSync(file)) return "";
    try {
      return fs.readFileSync(file, "utf8").slice(0, 12000);
    } catch {
      return "";
    }
  }

  private snapshotDecisions(phase: Phase): void {
    const file = path.join(this.config.contextPack, "03-decisions.md");
    if (!fs.existsSync(file)) return;
    try {
      fs.copyFileSync(
        file,
        path.join(this.config.runDir, `03-decisions.before-${phase}.md`),
      );
    } catch {
      this.scratchpad.record(
        ORCHESTRATOR_LABEL,
        phase,
        "note",
        "could not snapshot 03-decisions.md",
      );
    }
  }

  private async arbitrate(question: string, context: string): Promise<string> {
    if (this.config.askHuman) return this.askHuman(question);
    const decisions = this.humanDecisions();
    const prompt = [
      loadPrompt("orchestrator", this.promptVars()),
      "",
      decisions
        ? `## Decisions the human has already made — BINDING, do not re-open\n\n${decisions}\n\nIf the question below is already answered above, restate that answer and say it was already decided. Never contradict it.`
        : "",
      "",
      ARBITER_CONTRACT,
      "",
      "## What has happened in this phase",
      this.digest(ARBITER_DIGEST_LINES),
      context ? `\n## Extra context from the agent\n${context}` : "",
      "",
      "## The question",
      question,
    ].join("\n");

    let answer = "";
    try {
      for await (const message of query({
        prompt,
        options: {
          model: this.config.modelOverride ?? MODELS.haiku,
          cwd: this.config.worktree,
          settingSources: [],
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: this.config.configDir,
            MCP_TIMEOUT: MCP_STARTUP_TIMEOUT_MS,
            MCP_TOOL_TIMEOUT: MCP_TOOL_TIMEOUT_MS,
          },
          allowedTools: ["Read", "Grep", "Glob"],
          permissionMode: "bypassPermissions",
          maxTurns: 12,
          effort: "medium",
        },
      })) {
        if (message.type === "result" && message.subtype === "success") {
          answer = message.result.trim();
        }
      }
    } catch (error) {
      answer = `Arbiter failed (${String(error)}). State your assumption in your report and continue.`;
    }

    const verdict = parseArbiterVerdict(answer);
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      this.tracker.currentPhase(),
      "answer",
      `arbiter ${verdict.decision}: ${verdict.text.slice(0, 200)}`,
      { verdict },
    );
    if (verdict.decision === "defer") {
      return this.askHuman(verdict.text || question);
    }
    return (
      verdict.text || "No decision available. State your assumption and continue."
    );
  }

  private async askHuman(question: string): Promise<string> {
    const questionFile = path.join(this.config.runDir, "human-questions.md");
    fs.appendFileSync(
      questionFile,
      `\n## ${new Date().toISOString()}\n\n${question}\n`,
    );
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      this.tracker.currentPhase(),
      "question",
      `deferred to human: ${question}`,
      { questionFile },
    );

    if (this.config.mailboxDb) {
      process.stderr.write(
        `\n${"=".repeat(72)}\nDECISION NEEDED — posted to the mailbox, waiting\n${question}\n${"=".repeat(72)}\n`,
      );
      const posted = await askViaMailbox({
        dbPath: this.config.mailboxDb,
        runId: this.config.runId,
        question,
        fromAgent: ORCHESTRATOR_LABEL,
        phase: String(this.tracker.currentPhase()),
        onPost: (id) =>
          this.scratchpad.record(
            ORCHESTRATOR_LABEL,
            this.tracker.currentPhase(),
            "question",
            `mailbox question ${id} awaiting an answer`,
            { questionId: id },
          ),
      });
      const answer = posted.answer?.trim();
      this.scratchpad.record(
        ORCHESTRATOR_LABEL,
        this.tracker.currentPhase(),
        "answer",
        answer ? `human via mailbox: ${answer}` : "mailbox timed out",
        { questionId: posted.id },
      );
      return (
        answer ||
        "No answer arrived. Record the question in your report as an open decision, state the assumption you are proceeding under, and continue."
      );
    }

    if (this.config.nonInteractive) {
      return "The human is not available in this run. Record the question in your report as an open decision, state the assumption you are proceeding under, and continue.";
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    process.stderr.write(
      `\n${"=".repeat(72)}\nDECISION NEEDED\n${question}\n${"=".repeat(72)}\n`,
    );
    const reply = await rl.question("> ");
    rl.close();
    const answer = reply.trim();
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      this.tracker.currentPhase(),
      "answer",
      `human: ${answer}`,
    );
    return answer || "No answer given. Proceed under your stated assumption.";
  }

  private digest(limit: number): string {
    const lines: string[] = [];
    for (const [agent, events] of this.scratchpad.byAgent()) {
      for (const event of events.slice(-8)) {
        lines.push(`${agent} ${event.kind}: ${event.summary.slice(0, 220)}`);
      }
    }
    return lines.slice(-limit).join("\n") || "(nothing recorded yet)";
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
      this.scratchpad.record(
        ORCHESTRATOR_LABEL,
        phase,
        "note",
        `could not record phase state for ${phase}`,
      );
    }
  }

  private resolvePath(candidate: string): string {
    if (path.isAbsolute(candidate)) return candidate;
    const inPack = path.join(this.config.contextPack, candidate);
    if (fs.existsSync(inPack)) return inPack;
    return path.join(this.config.worktree, candidate);
  }

  private briefFor(step: Step): string {
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
    const role = PHASE_ROLE[phase];
    const common = `Check your inbox first. Your context pack is ${pack}.`;
    switch (phase) {
      case "survey":
        return step.cluster
          ? `Survey cluster ${step.cluster} for ${this.config.ticket}. Call worklist, judge every site, triage every one, and call finish. ${common}`
          : `No cluster was assigned. Escalate at level orchestrator rather than surveying anything.`;
      case "audit":
        return `Audit every finding with status "found" for ${this.config.ticket}. Re-derive each claim from the code and reject what you cannot reproduce. ${common}`;
      case "synthesize":
        return `Write the spike report for ${this.config.ticket} into ${pack}. Read the verified findings with the findings tool, then follow your prompt's file list. ${common}`;
      case "intake":
        return `Run intake for ${this.config.ticket}. Write ${pack}/01-ticket-and-context.md. ${common}`;
      case "grill":
        return `Find every decision ${this.config.ticket} leaves open, from ${pack}/01-ticket-and-context.md and the code it names. Write ${pack}/02a-open-questions.md and ${pack}/02a-open-questions.json. Look up every fact yourself and ask nothing. ${common}`;
      case "plan":
        return `Plan ${this.config.ticket} from ${pack}/01-ticket-and-context.md, with ${pack}/03-decisions.md binding. Write ${pack}/02-plan.md and one brief per slice, and append only to ${pack}/03-decisions.md. ${common}`;
      case "build": {
        const briefs = this.briefFiles();
        if (briefs.length === 0) {
          return `No brief files exist in ${pack}. Escalate at level orchestrator rather than inventing one.`;
        }
        return `Implement these briefs one at a time, in this order: ${briefs.join(", ")}. Finish one completely before starting the next. Run yarn tsc after each. ${common}`;
      }
      case "static":
        return `Run yarn static in ${this.config.worktree} and fix only what your own changes broke. Report anything else. ${common}`;
      case "test":
        return `Write and run usecase-level integration tests for the change on this branch. Report any failure that is an implementation defect with for_role "builder". Write ${pack}/05-test-notes.md. ${common}`;
      case "verify":
        return `Verify the change in the live application. Report anything broken with for_role "builder". Write ${pack}/06-verification.md. ${common}`;
      case "review":
        return `Review the diff against origin/dev for ${this.config.ticket}. Write ${pack}/07-review-findings.md. ${common}`;
      default:
        return `Run phase ${phase} as ${role}. ${common}`;
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

  private async pgPools(): Promise<Map<PgTenant, ReadOnlyPostgres>> {
    if (this.pools === undefined) {
      const { pools, notes } = await openPools(PURCO_WEB_ROOT);
      this.pools = pools;
      for (const note of notes) {
        this.scratchpad.record(
          ORCHESTRATOR_LABEL,
          "run",
          "note",
          `postgres ${note}`,
        );
      }
    }
    return this.pools;
  }

  private async serversFor(
    spec: RoleSpec,
    orchServer: McpServerConfig,
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
          this.handoffs.set(`${this.tracker.currentPhase()}:${agent}`, {
            summary,
            outputPath,
            produced: outputPath ? [outputPath] : [],
            openQuestions: 0,
            status: "complete",
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
    this.currentCluster = step.cluster ?? "";
    this.tracker.setPhase(phase);
    this.tracker.setMainLabel(label);
    this.snapshotDecisions(phase);
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      phase,
      "phase_start",
      `delegating ${describeStep(step)} to ${label}`,
    );
    this.recordPhaseState(
      phase,
      "in-progress",
      `${role} started`,
      ORCHESTRATOR_LABEL,
    );

    const handed = this.bus.relay(role, label, phase);
    const briefing = this.bus.briefing(handed);

    const vars = this.promptVars({
      AGENT: label,
      BRIEF: this.briefFor(step),
    });
    const agents = buildAgentDefinitions(
      vars,
      [role],
      this.config.modelOverride,
    );
    const model = modelFor(spec, this.config.modelOverride);
    const totals: StreamTotals = newTotals();
    const task = this.taskFor(step);
    this.journal.start(phase, task);
    const resumeNote = this.journal.resumeNote(phase);

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
        this.handoffs.set(`${phase}:${agent}`, handoff);
      },
    });

    const writeMode = spec.writes && this.config.autoApproveWrites;

    try {
      for await (const message of query({
        prompt: [
          task,
          briefing
            ? `The orchestrator hands you this from earlier phases:\n\n${briefing}`
            : "",
          resumeNote,
        ]
          .filter((part) => part.length > 0)
          .join("\n\n"),
        options: {
          agent: role,
          agents,
          model,
          cwd: this.config.worktree,
          settingSources: ["user", "project"],
          mcpServers: await this.serversFor(spec, server),
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: this.config.configDir,
            MCP_TIMEOUT: MCP_STARTUP_TIMEOUT_MS,
            MCP_TOOL_TIMEOUT: MCP_TOOL_TIMEOUT_MS,
          },
          allowedTools: [...spec.tools, ...ORCH_TOOL_NAMES],
          permissionMode: writeMode ? "acceptEdits" : "default",
          hooks: buildHooks({
            scratchpad: this.scratchpad,
            tracker: this.tracker,
            escalations: this.escalations,
            recordFileWritten: (file) => this.journal.recordFile(phase, file),
          }),
          forwardSubagentText: true,
          includePartialMessages: false,
          maxTurns: this.config.maxTurnsPerPhase,
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
          "The phase produced no work. Reword the role prompt, or run the phase in a fresh session, before retrying.",
      });
    }

    const handoff = this.handoffs.get(`${phase}:${label}`);
    const phaseEscalations = this.escalations.forPhase(phase);
    const hardStop = phaseEscalations.some((e) => e.level === "abort");
    const failed =
      totals.errors.length > 0 ||
      totals.subtype !== "success" ||
      totals.refusal !== undefined;

    const outcome: PhaseOutcome = {
      phase,
      agent: label,
      status: hardStop ? "failed" : failed ? "escalated" : "done",
      summary:
        handoff?.summary ??
        totals.result?.slice(0, 600) ??
        "no handoff recorded",
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
      `${phase} ${outcome.status} — $${outcome.costUsd.toFixed(4)}, ${outcome.turns} turns, ${totalTokens(outcome.tokens)} tokens on ${model}`,
      { outcome },
    );
    this.recordPhaseState(
      phase,
      outcome.status === "done" ? "done" : "in-progress",
      outcome.summary,
      label,
    );
    this.scratchpad.writeLive();

    this.journal.end(phase, outcome.status === "done" ? "done" : "interrupted");

    if (hardStop) this.aborted = true;
    return outcome;
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
      agent: step.cluster ? `-:${step.cluster}` : "-",
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
    if (this.store) {
      return this.store
        .phases()
        .reduce((sum, phase) => sum + (phase.costUsd ?? 0), 0);
    }
    return this.outcomes.reduce((sum, o) => sum + o.costUsd, 0);
  }

  private checkBudget(): void {
    const budget = this.config.budgetUsd;
    if (!budget || budget <= 0) return;
    const spent = this.spentSoFar();
    if (spent >= budget) {
      this.aborted = true;
      this.scratchpad.record(
        ORCHESTRATOR_LABEL,
        "run",
        "escalation",
        `budget spent: $${spent.toFixed(4)} of $${budget.toFixed(2)}; every later phase is skipped`,
        { spent, budget, phases: this.outcomes.map((o) => o.phase) },
      );
      return;
    }
    if (spent >= budget * BUDGET_WARN_AT && !this.budgetWarned) {
      this.budgetWarned = true;
      this.scratchpad.record(
        ORCHESTRATOR_LABEL,
        "run",
        "note",
        `budget warning: $${spent.toFixed(4)} of $${budget.toFixed(2)} spent`,
        { spent, budget },
      );
    }
  }

  private recordPhaseRow(index: number): void {
    const outcome = this.outcomes[index];
    if (!outcome || !this.store) return;
    this.store.endPhase({
      phase: outcome.phase,
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
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      "run",
      "run_start",
      `${this.config.ticket} — phases ${this.config.phases.join(" > ")}`,
      { config: { ...this.config } },
    );
    this.escalations.persist();
    this.bus.persist();

    if (this.config.resume) this.journal.markInterrupted();
    const done = this.config.resume
      ? new Set(this.store?.completedPhases() ?? [])
      : new Set<string>();
    if (done.size > 0) {
      this.scratchpad.record(
        ORCHESTRATOR_LABEL,
        "run",
        "note",
        `resume: skipping ${[...done].join(", ")}`,
        { skipped: [...done] },
      );
    }

    const steps = planSteps(this.config.phases, this.store).filter(
      (step) => !done.has(step.phase),
    );
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      "run",
      "note",
      `plan: ${steps.map(describeStep).join(" > ")}`,
      { steps },
    );

    let lastGatedPhase: Phase | undefined;
    for (const step of steps) {
      const outcomeIndex = this.outcomes.length;
      this.store?.startPhase(
        step.phase,
        stepLabel(PHASE_ROLE[step.phase], step),
      );
      if (this.aborted) {
        this.skipStep(step, "run aborted before this step");
        this.recordPhaseRow(outcomeIndex);
        continue;
      }

      if (this.store && step.phase !== lastGatedPhase) {
        const gate = phaseGate(step.phase, this.store, this.config.contextPack);
        lastGatedPhase = step.phase;
        if (!gate.ok) {
          this.scratchpad.record(
            ORCHESTRATOR_LABEL,
            step.phase,
            "escalation",
            `gate refused ${step.phase}: ${gate.reason}`,
          );
          this.skipStep(step, `gate refused: ${gate.reason}`);
          this.recordPhaseRow(outcomeIndex);
          continue;
        }
        this.scratchpad.record(
          ORCHESTRATOR_LABEL,
          step.phase,
          "note",
          `gate open for ${step.phase}: ${gate.reason}`,
        );
      }

      await this.runPhase(step);
      this.recordPhaseRow(outcomeIndex);
      this.checkBudget();
    }

    const totalCost = this.outcomes.reduce((sum, o) => sum + o.costUsd, 0);
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      "run",
      "run_end",
      `run ${this.aborted ? "ABORTED" : "complete"} — $${totalCost.toFixed(4)} across ${this.outcomes.length} phases`,
      { outcomes: this.outcomes },
    );
    try {
      this.writeReport(totalCost);
    } catch (error) {
      this.scratchpad.record(
        ORCHESTRATOR_LABEL,
        "run",
        "note",
        `could not write report.md: ${String(error)}`,
      );
    }
    this.store?.endRun(this.aborted ? "aborted" : "complete");
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
      `Run ${this.config.runId} · $${totalCost.toFixed(4)} · ${this.aborted ? "ABORTED" : "complete"}`,
      "",
      "## Phases",
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
      ...this.outcomes.map(
        (o) => `### ${o.phase} (${o.agent})\n\n${o.summary}\n`,
      ),
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
      ...this.bus
        .all()
        .map((m) => `- ${m.id} ${m.from} -> ${m.to}: ${m.subject}`),
    );
    fs.writeFileSync(
      path.join(this.config.runDir, "report.md"),
      lines.join("\n"),
    );
  }
}
