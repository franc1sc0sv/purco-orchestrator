import { createHash } from "node:crypto";
import { messageCost } from "./pricing.ts";
import { noUsage, type TokenUsage } from "./message-handler.ts";
import { THRESHOLDS, type Thresholds } from "./thresholds.ts";
import { STAGES, stageOfKey, type Stage } from "./types.ts";

export const WORKER_STATES = [
  "starting",
  "thinking",
  "tool",
  "waiting-human",
  "waiting-lead",
  "done",
  "failed",
  "halted",
] as const;

export type WorkerState = (typeof WORKER_STATES)[number];

export const ENDED_STATES: WorkerState[] = ["done", "failed", "halted"];
export const WAITING_STATES: WorkerState[] = ["waiting-human", "waiting-lead"];
export const ACTIVE_STATES: WorkerState[] = ["thinking", "tool"];

export type HaltReason = "burn rate" | "stuck";

export type WorkerRow = {
  id: string;
  ticket: string;
  runId: string;
  step: string;
  stage?: Stage;
  label: string;
  role: string;
  model: string;
  state: WorkerState;
  action: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  turns: number;
  maxTurns: number;
  contextTokens: number;
  filesRead: string[];
  filesWritten: string[];
  startedAt: string;
  lastEventAt: string;
  lastActivityAt: string;
  endedAt?: string;
  haltReason?: string;
};

export type Sample = {
  workerId: string;
  at: string;
  tokens: number;
  costUsd: number;
};

export const burnTokens = (usage: TokenUsage): number =>
  usage.input + usage.output + usage.cacheCreation;

export const workerId = (runId: string, step: string, label: string): string =>
  `${runId}|${step}|${label}`;

export const contextSize = (usage: TokenUsage): number =>
  usage.input + usage.cacheRead + usage.cacheCreation;

const maxUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: Math.max(a.input, b.input),
  output: Math.max(a.output, b.output),
  cacheRead: Math.max(a.cacheRead, b.cacheRead),
  cacheCreation: Math.max(a.cacheCreation, b.cacheCreation),
});

const sameUsage = (a: TokenUsage, b: TokenUsage): boolean =>
  a.input === b.input &&
  a.output === b.output &&
  a.cacheRead === b.cacheRead &&
  a.cacheCreation === b.cacheCreation;

export type LedgerTotals = {
  usage: TokenUsage;
  costUsd: number;
  turns: number;
  contextTokens: number;
};

export class UsageLedger {
  private readonly byMessage = new Map<string, { model: string; usage: TokenUsage }>();
  private lastUsage: TokenUsage = noUsage();

  add(messageId: string, model: string, usage: TokenUsage): boolean {
    const known = this.byMessage.get(messageId);
    const merged = known ? maxUsage(known.usage, usage) : usage;
    if (known && sameUsage(known.usage, merged)) return false;
    this.byMessage.set(messageId, { model, usage: merged });
    this.lastUsage = merged;
    return true;
  }

  totals(): LedgerTotals {
    const usage = noUsage();
    let costUsd = 0;
    for (const entry of this.byMessage.values()) {
      usage.input += entry.usage.input;
      usage.output += entry.usage.output;
      usage.cacheRead += entry.usage.cacheRead;
      usage.cacheCreation += entry.usage.cacheCreation;
      costUsd += messageCost(entry.model, entry.usage);
    }
    return {
      usage,
      costUsd,
      turns: this.byMessage.size,
      contextTokens: contextSize(this.lastUsage),
    };
  }
}

export const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export const normalRate = (
  history: number[],
  role: string,
  thresholds: Thresholds = THRESHOLDS,
): number => {
  if (history.length >= thresholds.historyMin) {
    const found = median(history);
    if (found !== undefined && found > 0) return found;
  }
  return thresholds.defaultTokensPerMin[role] ?? thresholds.fallbackTokensPerMin;
};

export const burnRate = (
  samples: { atMs: number; tokens: number }[],
  nowMs: number,
  thresholds: Thresholds = THRESHOLDS,
): number | undefined => {
  const inWindow = samples
    .filter((sample) => sample.atMs >= nowMs - thresholds.burnWindowMs)
    .sort((a, b) => a.atMs - b.atMs);
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  if (!first || !last || first === last) return undefined;
  const spanMs = last.atMs - first.atMs;
  if (spanMs < thresholds.burnMinSpanMs) return undefined;
  return ((last.tokens - first.tokens) / spanMs) * 60_000;
};

export type BurnLevel = 0 | 2 | 3;

export type BurnVerdict = {
  level: BurnLevel;
  over3Since?: number;
  stop: boolean;
};

export const evaluateBurn = (
  input: { rate: number | undefined; normal: number; over3Since?: number; nowMs: number },
  thresholds: Thresholds = THRESHOLDS,
): BurnVerdict => {
  const { rate, normal, nowMs } = input;
  if (rate === undefined || normal <= 0) return { level: 0, stop: false };
  const level: BurnLevel =
    rate >= normal * thresholds.burnStopFactor
      ? 3
      : rate >= normal * thresholds.burnAlertFactor
        ? 2
        : 0;
  if (level !== 3) return { level, stop: false };
  const over3Since = input.over3Since ?? nowMs;
  return {
    level,
    over3Since,
    stop: nowMs - over3Since >= thresholds.burnStopSustainMs,
  };
};

export type StuckVerdict = {
  alert: boolean;
  stop: boolean;
  reset: boolean;
};

export const isRunningBash = (state: WorkerState, action: string | undefined): boolean =>
  state === "tool" && action !== undefined && /^Bash(\s|$)/.test(action);

export const evaluateStuck = (
  input: {
    state: WorkerState;
    action?: string;
    lastActivityMs: number;
    alertedAtMs?: number;
    nowMs: number;
  },
  thresholds: Thresholds = THRESHOLDS,
): StuckVerdict => {
  const bash = isRunningBash(input.state, input.action);
  const afterMs = bash ? thresholds.bashStuckAfterMs : thresholds.stuckAfterMs;
  const stopAfterAlertMs = bash
    ? thresholds.bashStuckStopAfterAlertMs
    : thresholds.stuckStopAfterAlertMs;
  if (!ACTIVE_STATES.includes(input.state)) {
    return { alert: false, stop: false, reset: true };
  }
  if (input.nowMs - input.lastActivityMs < afterMs) {
    return { alert: false, stop: false, reset: true };
  }
  if (input.alertedAtMs === undefined) {
    return { alert: true, stop: false, reset: false };
  }
  return {
    alert: false,
    stop: input.nowMs - input.alertedAtMs >= stopAfterAlertMs,
    reset: false,
  };
};

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

export const callSignature = (tool: string, input: unknown): string =>
  `${tool}:${createHash("sha1").update(stable(input)).digest("hex")}`;

export type LoopState = { signature: string; count: number };

export const nextLoopState = (
  previous: LoopState | undefined,
  signature: string,
): LoopState =>
  previous && previous.signature === signature
    ? { signature, count: previous.count + 1 }
    : { signature, count: 1 };

export const isLoop = (
  state: LoopState,
  thresholds: Thresholds = THRESHOLDS,
): boolean => state.count >= thresholds.loopRepeats;

export type Totals = {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  turns: number;
  workers: number;
};

export type WorkerTotals = Totals & {
  id: string;
  step: string;
  label: string;
  role: string;
  state: WorkerState;
};

export type CostRollup = {
  ticket: Totals;
  stages: Record<Stage, Totals>;
  steps: Record<string, Totals>;
  workers: WorkerTotals[];
};

const emptyTotals = (): Totals => ({
  costUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cacheWrite: 0,
  turns: 0,
  workers: 0,
});

const addTo = (totals: Totals, row: WorkerRow): void => {
  totals.costUsd += row.costUsd;
  totals.tokensIn += row.tokensIn;
  totals.tokensOut += row.tokensOut;
  totals.cacheRead += row.cacheRead;
  totals.cacheWrite += row.cacheWrite;
  totals.turns += row.turns;
  totals.workers += 1;
};

export const rollupCosts = (rows: WorkerRow[]): CostRollup => {
  const ticket = emptyTotals();
  const stages = Object.fromEntries(
    STAGES.map((stage) => [stage, emptyTotals()]),
  ) as Record<Stage, Totals>;
  const steps: Record<string, Totals> = {};
  const workers: WorkerTotals[] = [];
  for (const row of rows) {
    addTo(ticket, row);
    const stage = row.stage ?? stageOfKey(row.step);
    if (stage) addTo(stages[stage], row);
    steps[row.step] ??= emptyTotals();
    addTo(steps[row.step] as Totals, row);
    const own = emptyTotals();
    addTo(own, row);
    workers.push({
      ...own,
      id: row.id,
      step: row.step,
      label: row.label,
      role: row.role,
      state: row.state,
    });
  }
  return { ticket, stages, steps, workers };
};
