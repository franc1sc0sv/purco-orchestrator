import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describeInput } from "./hooks.ts";
import { readUsage } from "./message-handler.ts";
import type { Store } from "./store.ts";
import {
  ENDED_STATES,
  UsageLedger,
  WAITING_STATES,
  burnTokens,
  callSignature,
  isLoop,
  nextLoopState,
  workerId,
  type LoopState,
  type WorkerRow,
  type WorkerState,
} from "./telemetry.ts";
import { THRESHOLDS } from "./thresholds.ts";
import { stageOfKey } from "./types.ts";

const MAX_FILES = 200;

export type MeterInit = {
  runId: string;
  ticket: string;
  step: string;
  label: string;
  role: string;
  model: string;
  maxTurns: number;
};

export type MeterDeps = {
  store: Store;
  now: () => number;
  onLoop: (row: WorkerRow, tool: string) => void;
};

const READING_TOOLS = new Set(["Read"]);
const WRITING_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

const filePathOf = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>).file_path;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const pushUnique = (list: string[], file: string): boolean => {
  if (list.includes(file) || list.length >= MAX_FILES) return false;
  list.push(file);
  return true;
};

export class WorkerMeter {
  private readonly deps: MeterDeps;
  private readonly ledger = new UsageLedger();
  private readonly row: WorkerRow;
  private loop: LoopState | undefined;
  private loopRaised = false;
  private lastSampleMs = 0;
  private stateBeforeWait: WorkerState = "thinking";
  private authoritative = false;

  constructor(deps: MeterDeps, init: MeterInit) {
    this.deps = deps;
    const at = new Date(deps.now()).toISOString();
    this.row = {
      id: workerId(init.runId, init.step, init.label),
      ticket: init.ticket,
      runId: init.runId,
      step: init.step,
      stage: stageOfKey(init.step),
      label: init.label,
      role: init.role,
      model: init.model,
      state: "starting",
      action: "",
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0,
      turns: 0,
      maxTurns: init.maxTurns,
      contextTokens: 0,
      filesRead: [],
      filesWritten: [],
      startedAt: at,
      lastEventAt: at,
      lastActivityAt: at,
    };
    this.save();
    this.sample(true);
  }

  get id(): string {
    return this.row.id;
  }

  get label(): string {
    return this.row.label;
  }

  get step(): string {
    return this.row.step;
  }

  get role(): string {
    return this.row.role;
  }

  snapshot(): WorkerRow {
    return { ...this.row };
  }

  isEnded(): boolean {
    return ENDED_STATES.includes(this.row.state);
  }

  private iso(): string {
    return new Date(this.deps.now()).toISOString();
  }

  private touch(activity: boolean): void {
    const at = this.iso();
    this.row.lastEventAt = at;
    if (activity) this.row.lastActivityAt = at;
  }

  private save(): void {
    this.deps.store.saveWorker(this.row);
  }

  private sample(force: boolean): void {
    const nowMs = this.deps.now();
    if (!force && nowMs - this.lastSampleMs < THRESHOLDS.sampleMs) return;
    this.lastSampleMs = nowMs;
    this.deps.store.recordSample({
      workerId: this.row.id,
      ticket: this.row.ticket,
      at: new Date(nowMs).toISOString(),
      tokens: burnTokens({
        input: this.row.tokensIn,
        output: this.row.tokensOut,
        cacheRead: 0,
        cacheCreation: this.row.cacheWrite,
      }),
      costUsd: this.row.costUsd,
    });
  }

  private applyTotals(): void {
    const totals = this.ledger.totals();
    this.row.tokensIn = totals.usage.input;
    this.row.tokensOut = totals.usage.output;
    this.row.cacheRead = totals.usage.cacheRead;
    this.row.cacheWrite = totals.usage.cacheCreation;
    this.row.costUsd = totals.costUsd;
    this.row.turns = totals.turns;
    this.row.contextTokens = totals.contextTokens;
  }

  onMessage(message: SDKMessage): void {
    if (this.isEnded()) return;
    if (message.type === "assistant") {
      const inner = message.message;
      const changed = this.ledger.add(inner.id, inner.model, readUsage(inner.usage));
      if (changed && !this.authoritative) this.applyTotals();
      if (this.row.state === "starting") this.row.state = "thinking";
      this.touch(false);
      this.save();
      this.sample(false);
      return;
    }
    if (message.type === "result") {
      const usage = readUsage(message.usage);
      this.authoritative = true;
      this.row.tokensIn = usage.input;
      this.row.tokensOut = usage.output;
      this.row.cacheRead = usage.cacheRead;
      this.row.cacheWrite = usage.cacheCreation;
      this.row.costUsd = message.total_cost_usd ?? this.row.costUsd;
      this.row.turns = message.num_turns ?? this.row.turns;
      this.touch(false);
      this.save();
      this.sample(true);
    }
  }

  toolStart(tool: string, input: Record<string, unknown>): void {
    if (this.isEnded()) return;
    const detail = describeInput(input);
    this.row.state = "tool";
    this.row.action = detail ? `${tool} ${detail}` : tool;
    const file = filePathOf(input);
    if (file && READING_TOOLS.has(tool)) pushUnique(this.row.filesRead, file);
    this.touch(true);
    this.save();
    this.loop = nextLoopState(this.loop, callSignature(tool, input));
    if (isLoop(this.loop) && !this.loopRaised) {
      this.loopRaised = true;
      this.deps.onLoop(this.snapshot(), tool);
    }
  }

  toolEnd(tool: string, input: Record<string, unknown>): void {
    if (this.isEnded()) return;
    const file = filePathOf(input);
    const wrote = file !== undefined && WRITING_TOOLS.has(tool) && pushUnique(this.row.filesWritten, file);
    if (this.row.state === "tool") this.row.state = "thinking";
    this.row.action = "";
    this.touch(wrote);
    this.save();
  }

  waiting(state: "waiting-human" | "waiting-lead"): void {
    if (this.isEnded() || WAITING_STATES.includes(this.row.state)) return;
    this.stateBeforeWait = this.row.state;
    this.row.state = state;
    this.touch(true);
    this.save();
  }

  resume(): void {
    if (this.isEnded() || !WAITING_STATES.includes(this.row.state)) return;
    this.row.state = this.stateBeforeWait;
    this.touch(true);
    this.save();
  }

  finish(state: "done" | "failed"): void {
    if (this.isEnded()) return;
    this.row.state = state;
    this.row.action = "";
    this.row.endedAt = this.iso();
    this.touch(false);
    this.save();
    this.sample(true);
  }

  halt(reason: string): void {
    if (this.row.state === "done") return;
    this.row.state = "halted";
    this.row.action = "";
    this.row.haltReason = reason;
    this.row.endedAt = this.iso();
    this.touch(false);
    this.save();
    this.sample(true);
  }
}
