import { snapshotOf } from "./story-view.ts";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { doneTitle, haltedTitle, humanTitle, loopTitle } from "./alert-title.ts";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { askViaMailbox } from "./mailbox.ts";
import { phaseGate } from "./gates.ts";
import {
  buildRecordResult,
  recordFlows,
  recordSkipReason,
  type RecordOutcome,
} from "./record.ts";
import { buildBrief, missingResultText } from "./brief.ts";
import { acquireLease } from "./lease.ts";
import { Alerts } from "./alerts.ts";
import { WorkerMeter } from "./meter.ts";
import { orchestratorToolsProblem } from "./orch-check.ts";
import { Watchdog } from "./watchdog.ts";
import { THRESHOLDS } from "./thresholds.ts";
import type { HaltReason } from "./telemetry.ts";
import {
  factsFromCounts,
  parseSizeAnswer,
  raiseSize,
  reviewTaskFor,
  sizeFor,
  sizeForBriefs,
  testDepthFor,
  type Size,
} from "./size.ts";
import { runForge, type ForgeJob, type ForgeResult } from "./forge.ts";
import { FORGE_SERVER, FORGE_SERVER_NAME } from "./forge-server.ts";
import { testWriteRefusal } from "./test-paths.ts";
import {
  describeWriteViolation,
  diffWriteSnapshots,
  rebaseAfterRestore,
  restoreWriteSnapshot,
  takeWriteSnapshot,
  type WriteSnapshot,
  writeAuditReason,
} from "./write-audit.ts";
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
import { takeNotes } from "./notes.ts";
import { Lead, type LeadDecision, type LeadDecisionKind, type LeadEvent } from "./lead.ts";
import {
  handleMessage,
  newTotals,
  totalTokens,
  type StreamTotals,
} from "./message-handler.ts";
import {
  buildAgentDefinitions,
  effortFor,
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
  MAX_GATE_REVISIONS,
  WORKFLOWS,
  type Workflow,
} from "./workflows.ts";
import {
  JUDGING_PHASES,
  MODELS,
  PHASE_ROLE,
  type HumanItemKind,
  type Phase,
  type PhaseOutcome,
  type RoleName,
  type RunConfig,
  type StepResult,
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

const NO_HUMAN =
  "The human is not available. Record the question in your output as an open decision, state the assumption you proceed under, and continue.";

type GateVerdict =
  | { kind: "approve" }
  | { kind: "stop"; reason: string }
  | { kind: "revise"; notes: string };

const NO_RESULT = "no result";
const BASE_BRANCH = "dev";
const DASHBOARD_URL = "http://localhost:4317";

const APPROVE = /^\s*(approve|approved|yes|y|ok|go|continue)\b/i;
const STOP = /^\s*stop\b/i;
const RERUN = /^\s*rerun\b\s*(\S+)?/i;

const tagged = (tag: string, body: string): string =>
  body ? `<${tag}>\n${body}\n</${tag}>` : "";

type WorkerJob = {
  role: RoleName;
  phase: Phase;
  key: string;
  label: string;
  tracker: SubagentTracker;
  task: string;
  brief?: string;
  parts: string[];
};

type WriteAudit = { before: WriteSnapshot; tainted: Set<string> };

export class Orchestrator {
  private readonly activeAudits = new Set<WriteAudit>();
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
  private leadCost = 0;
  private readonly store: Store | undefined;
  private currentCluster = "";
  private currentKey = "run";
  private size: Size | undefined;
  private sizeReason = "";
  private sizeNotice = "";
  private readonly alerts: Alerts | undefined;
  private readonly live = new Map<string, { meter: WorkerMeter; controller: AbortController }>();
  private haltSeen: string | undefined;
  private leadSeq = 0;

  private readonly config: RunConfig;

  constructor(config: RunConfig) {
    this.config = config;
    this.workflow = WORKFLOWS[config.workflow];
    this.store = config.mailboxDb
      ? new Store(config.mailboxDb, config.runId)
      : undefined;
    this.store?.bindTicket(config.ticket);
    if (config.workflow === "ticket") this.store?.setWorktree(config.worktree);
    this.scratchpad = new Scratchpad(
      config.runDir,
      config.runId,
      config.ticket,
      true,
      this.store,
    );
    this.alerts = this.store
      ? new Alerts(this.store, config.runId, config.ticket)
      : undefined;
    this.leadSeq = this.store?.decisions().length ?? 0;
    this.size = this.store?.size()?.size;
    this.sizeReason = this.store?.size()?.reason ?? "";
    this.scratch = new AgentScratch(config.runDir);
    this.journal = new Journal(config.runDir, config.runId, config.worktree);
    this.tracker = new SubagentTracker(this.scratchpad);
    this.bus = new MessageBus(this.scratchpad, config.runDir);
    this.escalations = new EscalationRegistry(this.scratchpad, config.runDir, {
      askOrchestrator: (question, context, from) => this.leadAnswer(question, context, from),
      askHuman: (question, _context, from) => this.askHuman(question, from),
    });
    this.lead = new Lead({
      systemPrompt: loadPrompt("lead", this.promptVars({ AGENT: LEAD_LABEL })),
      cwd: config.worktree,
      additionalDirectories: [config.contextPack],
      env: this.agentEnv(),
      model: config.modelOverride,
      onCost: (usd) => {
        this.leadCost += usd;
      },
    });
  }

  private agentEnv(): Record<string, string | undefined> {
    return {
      ...process.env,
      ...(this.config.configDir && { CLAUDE_CONFIG_DIR: this.config.configDir }),
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
    const stepKey = this.currentKey;
    const brief = buildBrief({
      kind: event.kind,
      body,
      stepKey,
      pack: this.config.contextPack,
      store: this.store,
    });
    let decision: LeadDecision;
    if (brief.missing.length > 0) {
      decision = { decision: "defer", text: missingResultText(brief.missing) };
    } else {
      this.leadSeq += 1;
      const meter = this.newMeter(
        stepKey,
        `${LEAD_LABEL}#${this.leadSeq}`,
        "lead",
        this.config.modelOverride ?? MODELS.opus,
        16,
      );
      decision = await this.lead.decide({ ...event, body: brief.text }, (message) =>
        meter?.onMessage(message),
      );
      meter?.finish("done");
    }
    this.store?.recordDecision({
      step: stepKey,
      kind: event.kind,
      subjects: brief.subjects,
      question: body,
      brief: brief.text,
      decision: decision.decision,
      text: decision.text,
    });
    this.scratchpad.record(
      LEAD_LABEL,
      this.tracker.currentPhase(),
      "answer",
      `lead ${event.kind} -> ${decision.decision}: ${decision.text.slice(0, 200)}`,
      { event: event.kind, decision },
    );
    return decision;
  }

  private newMeter(
    step: string,
    label: string,
    role: string,
    model: string,
    maxTurns: number,
  ): WorkerMeter | undefined {
    if (!this.store) return undefined;
    return new WorkerMeter(
      {
        store: this.store,
        now: Date.now,
        onLoop: (row, tool) => {
          this.alerts?.raise(
            "loop",
            `${row.label} called ${tool} with the same input ${THRESHOLDS.loopRepeats} times in a row`,
            { workerId: row.id, step: row.step, title: loopTitle(tool), dedupeKey: `${row.id}:loop` },
          );
        },
      },
      { runId: this.config.runId, ticket: this.config.ticket, step, label, role, model, maxTurns },
    );
  }

  private meterFor(from: string | undefined): WorkerMeter | undefined {
    const entries = [...this.live.values()].map((entry) => entry.meter);
    const named = entries.find((meter) => meter.label === from);
    if (named) return named;
    return entries.length === 1 ? entries[0] : undefined;
  }

  private async whileWaiting<T>(
    meter: WorkerMeter | undefined,
    state: "waiting-human" | "waiting-lead",
    work: () => Promise<T>,
  ): Promise<T> {
    meter?.waiting(state);
    try {
      return await work();
    } finally {
      meter?.resume();
    }
  }

  private haltWorker(id: string, reason: HaltReason): void {
    const entry = this.live.get(id);
    if (!entry || entry.meter.isEnded()) return;
    const { meter } = entry;
    meter.halt(reason);
    entry.controller.abort();
    this.haltSeen = reason;
    this.record(`${meter.label} halted: ${reason}`, "escalation", { worker: id, reason });
    this.alerts?.raise(
      "halted",
      `${meter.label} was stopped (${reason}). The run stops at ${meter.step}; resume it later.`,
      { workerId: id, step: meter.step, title: haltedTitle(reason), dedupeKey: `${id}:halted` },
    );
  }

  private async leadAnswer(question: string, context: string, from?: string): Promise<string> {
    if (this.config.askHuman) return this.askHuman(question, from);
    const phase = this.tracker.currentPhase();
    const judging = phase !== "run" && JUDGING_PHASES.includes(phase);
    const decision = await this.whileWaiting(this.meterFor(from), "waiting-lead", () =>
      this.leadDecide({
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
      }),
    );
    if (decision.decision === "defer") return this.askHuman(decision.text, from);
    return decision.text;
  }

  private async humanRaw(
    kind: HumanItemKind,
    text: string,
    from?: string,
    payload?: unknown,
  ): Promise<string | undefined> {
    const waitingKey = this.currentKey;
    const meter = this.meterFor(from);
    this.store?.setWaiting(waitingKey, true);
    this.alerts?.raise(kind, text, {
      workerId: meter?.id,
      step: waitingKey,
      title: humanTitle(kind, { text, step: waitingKey, role: meter?.role ?? from, payload }),
    });
    try {
      return await this.whileWaiting(meter, "waiting-human", () => this.postToHuman(kind, text, payload));
    } finally {
      this.store?.setWaiting(waitingKey, false);
    }
  }

  private async postToHuman(
    kind: HumanItemKind,
    text: string,
    payload?: unknown,
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
        payload,
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

  private async askHuman(question: string, from?: string): Promise<string> {
    return (await this.humanRaw("question", question, from)) ?? NO_HUMAN;
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

  private sizeNote(phase: Phase): string {
    if (phase === "grill") {
      if (this.size === "M") {
        return " Size M: mark a question blocking only when the plan cannot start without its answer; mark every other question non-blocking with your recommended answer.";
      }
      if (this.size === "L") {
        return " Size L: mark every open decision blocking.";
      }
    }
    if (phase === "plan") {
      if (this.size === "S") {
        return " Size S: no grill ran, so 03-decisions.md may not exist. Write one brief only, and list every assumption you make under an Assumptions heading in 02-plan.md.";
      }
      if (this.size === "M") return " Size M: write one to three briefs.";
      if (this.size === "L") {
        return " Size L: split the change into as many briefs as its slices need, and name every ADR in docs/adr the change touches or contradicts.";
      }
    }
    return "";
  }

  private taskFor(step: Step): string {
    return `${this.baseTaskFor(step)}${this.sizeNote(step.phase)}`;
  }

  private baseTaskFor(step: Step): string {
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
        return `Find every decision ${ticket} leaves open, from ${pack}/01-ticket-and-context.md and the code it names. Write ${pack}/02a-open-questions.md and ${pack}/02a-open-questions.json. Give every question its explain, example and option examples, and a diagram when it helps. Look up every fact yourself and ask nothing. ${common}`;
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
        return `Verify the change in the live application. Report each broken flow with report, for_role "builder", and include what you saw. Write ${pack}/06-verification.md. For each acceptance criterion that passes, write a recording script and ${pack}/verify/flows/flows.json as your prompt describes, and list them in the handoff produced and counts.flows. ${common}`;
      case "review":
        return reviewTaskFor({ size: this.size, ticket, base: BASE_BRANCH, pack });
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
    if (spec.needsForge) {
      servers[FORGE_SERVER_NAME] = FORGE_SERVER;
    }
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

    const briefing = this.bus.briefing(this.bus.relay(role, label, phase));
    const outcome = await this.runWorker({
      role,
      phase,
      key,
      label,
      tracker: this.tracker,
      task: this.taskFor(step),
      brief: step.brief ?? this.clusterBrief(step),
      parts: [
        tagged("defects_to_fix", step.fix ?? ""),
        tagged("handed_messages", briefing),
        tagged("human_notes", step.notes ?? ""),
      ],
    });
    this.tracker.setMainLabel(ORCHESTRATOR_LABEL);
    this.outcomes.push(outcome);
    this.recordPhaseState(
      phase,
      outcome.status === "done" ? "done" : "in-progress",
      outcome.summary,
      label,
    );
    if (outcome.status === "failed") this.stop(`${key} raised an abort`);
    return outcome;
  }

  private async runWorker(job: WorkerJob): Promise<PhaseOutcome> {
    const spec = ROLE_SPECS[job.role];
    const vars = this.promptVars({ AGENT: job.label, BRIEF: job.brief ?? "" });
    const agents = buildAgentDefinitions(vars, [job.role], this.config.modelOverride, this.size);
    const model = modelFor(spec, this.config.modelOverride);
    const totals: StreamTotals = newTotals();
    this.journal.start(job.key, job.task);
    const maxTurns = Math.min(spec.maxTurns, this.config.maxTurnsPerPhase);
    const meter = this.newMeter(job.key, job.label, job.role, model, maxTurns);
    const controller = new AbortController();
    if (meter) this.live.set(meter.id, { meter, controller });
    const resumeNote = this.journal.resumeNote(job.key);

    const server = buildOrchestratorServer({
      scratchpad: this.scratchpad,
      bus: this.bus,
      escalations: this.escalations,
      scratch: this.scratch,
      currentPhase: () => job.phase,
      currentRole: () => job.role,
      activeAgent: () => job.tracker.active(),
      resolvePath: (candidate) => this.resolvePath(candidate),
      recordHandoff: (agent, handoff) => {
        this.handoffs.set(`${job.key}:${agent}`, handoff);
        if (handoff.appliedNotes?.length) this.store?.applyNotes(handoff.appliedNotes);
      },
    });

    const writeMode = spec.writes && this.config.autoApproveWrites;
    let audit: WriteAudit | undefined;
    if (spec.testFilesOnly) {
      try {
        audit = { before: takeWriteSnapshot(this.config.worktree), tainted: new Set() };
      } catch (error) {
        const summary = `write audit unavailable: ${writeAuditReason(error)}`;
        return this.failWriteAudit(job, model, totals, meter, summary);
      }
      this.activeAudits.add(audit);
    }
    let toolsProblem: string | undefined;

    try {
      for await (const message of query({
        prompt: [job.task, ...job.parts, tagged("resume_note", resumeNote)]
          .filter((part) => part.length > 0)
          .join("\n\n"),
        options: {
          agent: job.role,
          agents,
          model,
          cwd: this.config.worktree,
          additionalDirectories: [this.config.contextPack],
          settingSources: ["project"],
          mcpServers: await this.serversFor(spec, server, job.key),
          env: this.agentEnv(),
          allowedTools: [...spec.tools, ...ORCH_TOOL_NAMES],
          permissionMode: writeMode ? "acceptEdits" : "default",
          hooks: buildHooks({
            scratchpad: this.scratchpad,
            tracker: job.tracker,
            recordFileWritten: (file) => this.journal.recordFile(job.key, file),
            meter,
            takeNotes: (agent, toolInput) =>
              this.store
                ? takeNotes({ store: this.store, worktree: this.config.worktree, agent, toolInput })
                : undefined,
            refuse: spec.testFilesOnly
              ? (tool, input) => testWriteRefusal(tool, input, this.config.worktree)
              : undefined,
          }),
          forwardSubagentText: true,
          includePartialMessages: false,
          abortController: controller,
          maxTurns,
          effort: effortFor(spec, this.size),
        },
      })) {
        if (message.type === "system" && message.subtype === "init") {
          toolsProblem = orchestratorToolsProblem(message);
          if (toolsProblem !== undefined) {
            controller.abort();
            break;
          }
        }
        handleMessage(
          message,
          { scratchpad: this.scratchpad, tracker: job.tracker },
          totals,
        );
        meter?.onMessage(message);
      }
    } catch (error) {
      if (meter?.snapshot().state !== "halted") totals.errors.push(String(error));
    }
    const verdict = audit ? this.finishWriteAudit(audit, job, meter?.id) : undefined;
    if (verdict?.unavailable !== undefined) {
      return this.failWriteAudit(job, model, totals, meter, verdict.unavailable);
    }
    const violation = verdict?.violation;
    if (toolsProblem !== undefined) {
      return this.failForMissingTools(job, model, totals, meter, toolsProblem);
    }
    const haltReason = meter?.snapshot().haltReason;

    if (totals.refusal) {
      await this.escalations.raise({
        from: job.label,
        phase: job.phase,
        level: "abort",
        summary: `${job.role} was refused by the model on turn ${totals.turns}`,
        detail: totals.refusal,
        blocker:
          "The step produced no work. Reword the role prompt, or run the step in a fresh session, before retrying.",
      });
    }

    const handoff = this.handoffs.get(`${job.key}:${job.label}`);
    const phaseEscalations = this.escalations.forPhase(job.phase);
    const hardStop = phaseEscalations.some((e) => e.level === "abort");
    const failed =
      totals.errors.length > 0 ||
      totals.subtype !== "success" ||
      totals.refusal !== undefined;
    const delivered = handoff?.status === "delivered";
    const result: StepResult = handoff ?? {
      status: "failed",
      summary: NO_RESULT,
      produced: [],
      openQuestions: 0,
    };

    const outcome: PhaseOutcome = {
      phase: job.phase,
      agent: job.label,
      status: haltReason
        ? "escalated"
        : hardStop
          ? "failed"
          : failed || !delivered
            ? "escalated"
            : "done",
      halt: haltReason,
      summary: haltReason
        ? `halted: ${haltReason}`
        : handoff
          ? `${handoff.status}: ${handoff.summary}${handoff.evidence ? ` (evidence: ${handoff.evidence})` : ""}`
          : NO_RESULT,
      outputPath: handoff?.outputPath,
      sessionId: totals.sessionId,
      costUsd: totals.costUsd,
      turns: totals.turns,
      tokens: totals.usage,
      model,
      escalations: phaseEscalations.map((e) => e.id),
      errors: totals.errors,
      result,
    };

    if (violation) {
      const summary = `changed production code: ${violation}`;
      outcome.status = "failed";
      outcome.summary = summary;
      outcome.errors = [...outcome.errors, summary];
      outcome.result = { status: "failed", summary, produced: [], openQuestions: 0, evidence: summary };
    }

    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      job.phase,
      "phase_end",
      `${job.key} ${outcome.status} — $${outcome.costUsd.toFixed(4)}, ${outcome.turns} turns, ${totalTokens(outcome.tokens)} tokens on ${model}`,
      { outcome },
    );
    this.scratchpad.writeLive();
    this.journal.end(job.key, outcome.status === "done" ? "done" : "interrupted");
    meter?.finish(outcome.status === "done" ? "done" : "failed");
    if (meter) this.live.delete(meter.id);
    if (haltReason) this.stop(`${job.key} halted: ${haltReason}`);
    return outcome;
  }

  private finishWriteAudit(
    audit: WriteAudit,
    job: WorkerJob,
    workerId: string | undefined,
  ): { violation?: string; unavailable?: string } {
    this.activeAudits.delete(audit);
    let own: string[];
    try {
      const after = takeWriteSnapshot(this.config.worktree);
      own = diffWriteSnapshots(audit.before, after);
    } catch (error) {
      this.invalidateOverlapping();
      return { unavailable: `write audit unavailable: ${writeAuditReason(error)}` };
    }
    if (own.length > 0) {
      const failed = restoreWriteSnapshot(this.config.worktree, audit.before, own);
      if (failed.length > 0) {
        this.invalidateOverlapping(own);
        return { unavailable: `restore failed: ${describeWriteViolation(failed)}` };
      }
      for (const other of this.activeAudits) {
        for (const file of own) other.tainted.add(file);
        rebaseAfterRestore(other.before, audit.before, own);
      }
    }
    const files = [...new Set([...audit.tainted, ...own])];
    if (files.length === 0) return {};
    const described = describeWriteViolation(files);
    this.alerts?.raise("halted", `${job.label}: changed production code: ${described}`, {
      workerId,
      step: job.key,
      title: "Test author changed production code",
      dedupeKey: `${job.key}:write-audit`,
    });
    return { violation: described };
  }

  private invalidateOverlapping(files: string[] = []): void {
    for (const other of this.activeAudits) {
      for (const file of files.length > 0 ? files : ["write audit unavailable"]) other.tainted.add(file);
    }
  }

  private failWriteAudit(
    job: WorkerJob,
    model: string,
    totals: StreamTotals,
    meter: WorkerMeter | undefined,
    summary: string,
  ): PhaseOutcome {
    const outcome = this.failedOutcome(job, model, totals, summary);
    this.scratchpad.record(ORCHESTRATOR_LABEL, job.phase, "phase_end", `${job.key} failed: ${summary}`, { outcome });
    this.scratchpad.writeLive();
    this.journal.end(job.key, "interrupted");
    meter?.finish("failed");
    if (meter) this.live.delete(meter.id);
    this.alerts?.raise("halted", `${job.label}: ${summary}`, {
      workerId: meter?.id,
      step: job.key,
      title: "Write audit failed",
      dedupeKey: `${job.key}:write-audit-failed`,
    });
    this.stop(`${job.key}: ${summary}`);
    return outcome;
  }

  private failedOutcome(job: WorkerJob, model: string, totals: StreamTotals, summary: string): PhaseOutcome {
    return {
      phase: job.phase,
      agent: job.label,
      status: "failed",
      summary,
      sessionId: totals.sessionId,
      costUsd: totals.costUsd,
      turns: totals.turns,
      tokens: totals.usage,
      model,
      escalations: [],
      errors: [summary],
      result: { status: "failed", summary, produced: [], openQuestions: 0, evidence: summary },
    };
  }

  private failForMissingTools(
    job: WorkerJob,
    model: string,
    totals: StreamTotals,
    meter: WorkerMeter | undefined,
    problem: string,
  ): PhaseOutcome {
    const summary = `orchestrator tools missing: ${problem}`;
    const outcome: PhaseOutcome = {
      phase: job.phase,
      agent: job.label,
      status: "failed",
      summary,
      sessionId: totals.sessionId,
      costUsd: totals.costUsd,
      turns: totals.turns,
      tokens: totals.usage,
      model,
      escalations: [],
      errors: [summary],
      result: { status: "failed", summary, produced: [], openQuestions: 0, evidence: summary },
    };
    this.scratchpad.record(ORCHESTRATOR_LABEL, job.phase, "phase_end", `${job.key} failed: ${summary}`, { outcome });
    this.scratchpad.writeLive();
    this.journal.end(job.key, "interrupted");
    meter?.finish("failed");
    if (meter) this.live.delete(meter.id);
    this.alerts?.raise("halted", `${job.label}: ${summary}`, {
      workerId: meter?.id,
      step: job.key,
      title: haltedTitle(summary),
      dedupeKey: `${job.key}:orch-tools`,
    });
    this.stop(`${job.key}: ${summary}`);
    return outcome;
  }

  private async forgeWorker(job: ForgeJob): Promise<PhaseOutcome> {
    const key = `test:${job.name}`;
    const label = `${job.role.toUpperCase()}-${job.name.split(":").pop() ?? job.name}`;
    const tracker = new SubagentTracker(this.scratchpad);
    tracker.setPhase("test");
    tracker.setMainLabel(label);
    this.store?.startPhase(key, label);
    this.scratchpad.record(ORCHESTRATOR_LABEL, "test", "phase_start", `delegating ${key} to ${label}`);
    const outcome = await this.runWorker({
      role: job.role,
      phase: "test",
      key,
      label,
      tracker,
      task: job.task,
      parts: job.parts ?? [],
    });
    this.outcomes.push(outcome);
    this.storeOutcome(key, outcome);
    return outcome;
  }

  private testDepth(): "full" | "quick" {
    if (
      this.config.testDepthExplicit ||
      this.config.workflow !== "ticket" ||
      !this.size
    ) {
      return this.config.testDepth;
    }
    return testDepthFor(this.size);
  }

  private testMode(): "write" | "harden" {
    if (this.config.testMode) return this.config.testMode;
    const file = path.join(this.config.contextPack, "test-mode.txt");
    return fs.existsSync(file) && fs.readFileSync(file, "utf8").trim() === "harden"
      ? "harden"
      : "write";
  }

  private async runTestStep(step: Step): Promise<PhaseOutcome> {
    const key = stepKey(step);
    const label = step.attempt && step.attempt > 1 ? `TEST-FORGE#${step.attempt}` : "TEST-FORGE";
    this.currentKey = key;
    this.tracker.setPhase(step.phase);
    this.scratchpad.record(ORCHESTRATOR_LABEL, step.phase, "phase_start", `${key}: Test Forge stages start`);
    this.recordPhaseState(step.phase, "in-progress", "test forge started", ORCHESTRATOR_LABEL);
    const logFile = path.join(this.config.runDir, "forge.log");

    let forge: ForgeResult;
    try {
      forge = await runForge({
        worktree: this.config.worktree,
        pack: this.config.contextPack,
        ticket: this.config.ticket,
        base: BASE_BRANCH,
        scope: this.config.testScope,
        depth: this.testDepth(),
        mode: this.testMode(),
        size: this.config.workflow === "ticket" ? this.size : undefined,
        targets: this.config.testTargets,
        focus: step.fix ? `Confirm the fixes for:\n${step.fix}` : this.config.testFocus,
        fresh: Boolean(step.attempt && step.attempt > 1),
        spawn: (job) => this.forgeWorker(job),
        ask: (kind, text, payload) => this.humanRaw(kind, text, undefined, payload),
        decide: (question) => this.leadAnswer(question, ""),
        log: (line) => {
          fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
          this.record(`forge: ${line.slice(0, 300)}`);
        },
      });
    } catch (error) {
      this.record(`test forge failed to run: ${String(error)}`, "escalation");
      return this.recordForgeOutcome(step, label, "escalated", `Test Forge failed to run: ${String(error)}`, [String(error)]);
    }

    if (forge.refusal && this.config.workflow === "ticket") {
      this.record(`test forge refused (${forge.refusal}); the tester worker runs instead`, "escalation");
      return this.runPhase(step);
    }

    for (const defect of forge.defects) {
      this.bus.report({
        from: label,
        subject: `[finding] ${defect.title}`,
        body: `Test Forge confirmed a defect in the production code: ${defect.findingKey}. The test stays red on purpose until the code is fixed. The stage log is ${logFile}.`,
        forRole: "builder",
        phase: step.phase,
      });
    }
    return this.recordForgeOutcome(step, label, forge.status, forge.summary, []);
  }

  private recordForgeOutcome(
    step: Step,
    label: string,
    status: PhaseOutcome["status"],
    summary: string,
    errors: string[],
  ): PhaseOutcome {
    const outcome: PhaseOutcome = {
      phase: step.phase,
      agent: label,
      status,
      summary,
      costUsd: 0,
      turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      model: "-",
      escalations: this.escalations.forPhase(step.phase).map((e) => e.id),
      errors,
    };
    this.outcomes.push(outcome);
    this.scratchpad.record(ORCHESTRATOR_LABEL, step.phase, "phase_end", `${stepKey(step)} ${status} — ${summary}`, { outcome });
    this.recordPhaseState(step.phase, status === "done" ? "done" : "in-progress", summary, label);
    this.scratchpad.writeLive();
    return outcome;
  }

  private recordSkip(step: Step): string | undefined {
    return step.phase === "record"
      ? recordSkipReason(this.config.worktree, this.config.contextPack)
      : undefined;
  }

  private async runRecordStep(step: Step): Promise<PhaseOutcome> {
    const key = stepKey(step);
    const label = "RECORDER";
    this.currentKey = key;
    this.tracker.setPhase(step.phase);
    this.scratchpad.record(ORCHESTRATOR_LABEL, step.phase, "phase_start", `${key}: recording flow videos`);
    this.recordPhaseState(step.phase, "in-progress", "recording started", ORCHESTRATOR_LABEL);
    let outcome: RecordOutcome;
    try {
      outcome = await recordFlows({
        worktree: this.config.worktree,
        pack: this.config.contextPack,
        tenant: process.env.TENANT ?? "purco",
        onProgress: (runs, total, next) => {
          const note = next
            ? `recording ${runs.length + 1} of ${total}: ${next.file}`
            : `recorded ${runs.length} of ${total}`;
          this.store?.noteStep(key, note);
          this.store?.recordResult(key, buildRecordResult(runs, total));
          this.record(note);
        },
      });
    } catch (error) {
      outcome = { status: "failed", summary: `recording failed to run: ${String(error)}` };
    }
    const phaseOutcome = this.recordForgeOutcome(
      step,
      label,
      outcome.status,
      outcome.summary,
      outcome.status === "failed" ? [outcome.summary] : [],
    );
    phaseOutcome.result = outcome.result;
    return phaseOutcome;
  }

  private async grill(step: Step): Promise<PhaseOutcome> {
    const key = stepKey(step);
    this.currentKey = key;
    this.tracker.setPhase(step.phase);
    const result = await runGrill({
      pack: this.config.contextPack,
      ask: (text, payload) => this.humanRaw("question", text, undefined, payload),
      dashboardLink: (questionId) =>
        `${DASHBOARD_URL}/#/t/${this.config.ticket}/plan?q=${questionId}`,
      earlyAnswer: (questionId) => this.store?.earlyAnswer(this.config.ticket, questionId),
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

  private sizeSkip(step: Step): string | undefined {
    return step.phase === "grill" && this.size === "S"
      ? "size S: the plan lists its assumptions"
      : undefined;
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
    const cardText = card.decision === "answer" ? card.text : outcome.summary;
    const text = [cardText, this.sizeLines(step)].filter(Boolean).join("\n\n");
    const gatesDir = path.join(this.config.runDir, "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    const cardFile = path.join(gatesDir, `${key.replace(/[^\w.-]+/g, "_")}.md`);
    fs.writeFileSync(cardFile, text);

    const answer = await this.humanRaw(
      "gate",
      `${text}\n\n---\nReply "approve" to continue, "stop" to end the run here, or write what must change and ${key} runs again with your notes.`,
    );
    if (!answer) return { kind: "stop", reason: `no answer at the ${key} gate; the card is in ${cardFile}` };
    const chosen = step.phase === "intake" ? parseSizeAnswer(answer) : undefined;
    if (chosen) {
      this.setSize(chosen, "set by the human at the intake gate");
      return { kind: "approve" };
    }
    if (APPROVE.test(answer)) return { kind: "approve" };
    if (STOP.test(answer)) return { kind: "stop", reason: `the human stopped the run at the ${key} gate` };
    if ((step.attempt ?? 1) >= MAX_GATE_REVISIONS) {
      return { kind: "stop", reason: `${key} reached ${MAX_GATE_REVISIONS} revisions at its gate` };
    }
    return { kind: "revise", notes: answer };
  }

  private sizeLines(step: Step): string {
    if (step.phase === "intake" && this.size) {
      return `Size: ${this.size}, because: ${this.sizeReason}\nReply "S", "M" or "L" (or "approve size L") to set the size and continue.`;
    }
    const notice = this.sizeNotice;
    this.sizeNotice = "";
    return notice;
  }

  private setSize(size: Size, reason: string): void {
    this.size = size;
    this.sizeReason = reason;
    this.store?.setSize(size, reason);
    this.record(`size ${size}: ${reason}`, "note", { size, reason });
  }

  private sizeFromIntake(outcome: PhaseOutcome): void {
    const facts = factsFromCounts(outcome.result?.counts);
    if ("missing" in facts) {
      this.setSize("M", `intake did not report ${facts.missing.join(", ")}, so the size defaults to M`);
      return;
    }
    const verdict = sizeFor(facts);
    this.setSize(verdict.size, verdict.reasons.join("; "));
  }

  private recordStory(step: Step, outcome: PhaseOutcome): void {
    if (!this.store) return;
    const result = outcome.result;
    if (step.phase === "intake" && result?.kind) this.store.setKind(result.kind);
    if (step.phase !== "build" && step.phase !== "review") return;
    if (result?.story) this.store.setStory(result.story);
    this.store.setChanges(snapshotOf(this.config.worktree));
  }

  private raiseSizeForBriefs(): void {
    const before = this.size;
    if (!before) return;
    const briefs = this.briefFiles().length;
    const raised = raiseSize(
      before,
      sizeForBriefs(briefs),
      `the plan produced ${briefs} briefs, more than size ${before} allows`,
    );
    if (!raised.raised) return;
    this.setSize(raised.size, raised.reason);
    this.sizeNotice = `Size raised from ${before} to ${raised.size}: ${raised.reason}.`;
    this.leadBacklog.push(this.sizeNotice);
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

  private skipStep(step: Step, why: string): PhaseOutcome {
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      step.phase,
      "phase_end",
      `${describeStep(step)} skipped — ${why}`,
    );
    const outcome: PhaseOutcome = {
      phase: step.phase,
      agent: "-",
      status: "skipped",
      summary: why,
      costUsd: 0,
      turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      escalations: [],
      errors: [],
    };
    this.outcomes.push(outcome);
    return outcome;
  }

  private resultFor(outcome: PhaseOutcome): StepResult | undefined {
    if (outcome.result) return outcome.result;
    if (outcome.status === "skipped") return undefined;
    const status =
      outcome.status === "done"
        ? "delivered"
        : outcome.status === "failed"
          ? "failed"
          : "blocked";
    return {
      status,
      summary: outcome.summary,
      outputPath: outcome.outputPath,
      produced: outcome.outputPath ? [outcome.outputPath] : [],
      openQuestions: 0,
      evidence: status === "delivered" ? undefined : outcome.summary,
    };
  }

  private storeOutcome(key: string, outcome: PhaseOutcome): void {
    if (!this.store) return;
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
    const result = this.resultFor(outcome);
    if (result) this.store.recordResult(key, result);
    if (outcome.halt) this.store.haltStep(key, `halted: ${outcome.halt}`);
  }

  async run(): Promise<PhaseOutcome[]> {
    const lease = this.store ? acquireLease(this.store) : undefined;
    const watchdog =
      this.store && this.alerts
        ? new Watchdog({
            store: this.store,
            alerts: this.alerts,
            ticket: this.config.ticket,
            runId: this.config.runId,
            now: Date.now,
            halt: (id, reason) => this.haltWorker(id, reason),
          })
        : undefined;
    watchdog?.start();
    try {
      if (lease?.stolenFrom) {
        this.record(
          `took the lease of run ${lease.stolenFrom.runId}, which stopped beating`,
        );
      }
      return await this.runSteps();
    } finally {
      watchdog?.stop();
      lease?.release();
    }
  }

  private async runSteps(): Promise<PhaseOutcome[]> {
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
    this.store?.registerSteps(queue.map(stepKey));

    const gated = new Set<Phase>();
    while (queue.length > 0) {
      const step = queue.shift() as Step;
      if (step.phase === "build" && !step.brief) {
        const briefs = this.briefFiles();
        if (briefs.length > 0) {
          const expanded = briefSteps(briefs);
          this.store?.removeStep("build");
          this.store?.registerSteps(expanded.map(stepKey));
          queue.unshift(...expanded);
          this.record(`build expands to ${briefs.length} brief step(s)`);
          continue;
        }
      }

      const key = stepKey(step);
      if (done.has(key)) continue;

      const skipReason = this.sizeSkip(step) ?? this.recordSkip(step);
      if (skipReason) {
        this.store?.startPhase(key, "-");
        this.storeOutcome(key, this.skipStep(step, skipReason));
        continue;
      }

      this.store?.startPhase(key, step.human ? "HUMAN" : stepLabel(PHASE_ROLE[step.phase], step));
      if (this.aborted) {
        this.storeOutcome(key, this.skipStep(step, `run stopped before this step: ${this.stopReason}`));
        continue;
      }

      if (this.store && !step.human && !gated.has(step.phase)) {
        gated.add(step.phase);
        const gate = phaseGate(step.phase, this.store, this.config.contextPack);
        if (!gate.ok) {
          this.storeOutcome(key, this.skipStep(step, `gate refused: ${gate.reason}`));
          this.stop(`gate refused ${step.phase}: ${gate.reason}`);
          continue;
        }
        this.record(`gate open for ${step.phase}: ${gate.reason}`);
      }

      const outcome = step.human
        ? await this.grill(step)
        : step.phase === "test"
          ? await this.runTestStep(step)
          : step.phase === "record"
            ? await this.runRecordStep(step)
            : await this.runPhase(step);
      if (this.haltSeen && outcome.status !== "done" && !outcome.halt) {
        outcome.halt = this.haltSeen;
      }
      this.storeOutcome(key, outcome);
      if (this.aborted) continue;

      if (outcome.status === "done" && this.config.workflow === "ticket") {
        if (step.phase === "intake") this.sizeFromIntake(outcome);
        this.recordStory(step, outcome);
        if (step.phase === "plan") this.raiseSizeForBriefs();
      }

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
    if (!this.aborted) {
      this.alerts?.raise(
        "done",
        `${this.config.ticket} run complete, $${totalCost.toFixed(2)}`,
        { step: "run", title: doneTitle(totalCost), dedupeKey: "run:done" },
      );
    }
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
      `Size ${this.size ?? "-"} · lead decisions ${this.store?.decisions().length ?? 0} · lead cost $${this.leadCost.toFixed(4)}`,
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
      `Total tokens: ${this.outcomes.reduce((sum, o) => sum + totalTokens(o.tokens), 0)}`,
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
