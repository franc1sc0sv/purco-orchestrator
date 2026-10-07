import fs from "node:fs";
import path from "node:path";
import { Store, type OpenHumanItem, type StoredAlert, type StoredDecision } from "./store.ts";
import {
  ENDED_STATES,
  WAITING_STATES,
  isRunningBash,
  type CostRollup,
  type Sample,
  type WorkerRow,
} from "./telemetry.ts";
import { THRESHOLDS } from "./thresholds.ts";
import {
  STAGES,
  type PipelineStage,
  type PipelineStep,
  type Stage,
  type StepStatus,
} from "./types.ts";

export const GAF =
  process.env.PURCO_GAF ??
  path.join(process.env.HOME ?? "", "projects/purco-projects/general-access-files");

const LEASE_ALIVE_MS = 60_000;
const DEFAULT_SAMPLE_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_SAMPLES = 6000;

export const TICKET_STATES = [
  "running",
  "waiting",
  "stuck",
  "halted",
  "failed",
  "done",
  "idle",
] as const;

export type TicketState = (typeof TICKET_STATES)[number];

export type StageSummary = {
  stage: Stage;
  status: StepStatus;
  progress: number;
  done: number;
  total: number;
};

export type TicketSummary = {
  ticket: string;
  size: string | null;
  sizeReason: string | null;
  state: TicketState;
  stages: StageSummary[];
  costUsd: number;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  liveAgents: number;
  openItemCount: number;
  unseenAlerts: StoredAlert[];
  activeRun: string | null;
  heartbeatAgeSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  elapsedMs: number;
  updatedAt: number;
};

export type TicketDetail = {
  summary: TicketSummary;
  pipeline: PipelineStage[];
  workers: WorkerRow[];
  liveWorkerIds: string[];
  cost: CostRollup;
  alerts: StoredAlert[];
  decisions: StoredDecision[];
  items: OpenHumanItem[];
  samples: Sample[];
  generatedAt: string;
};

export type HistoryEntry = {
  ticket: string;
  size: string | null;
  costUsd: number;
  tokens: number;
  durationMs: number;
  stageDurationsMs: Record<Stage, number>;
  endedAt: string | null;
};

const dbPathOf = (ticket: string): string => path.join(GAF, ticket, "orchestrator.sqlite");

export const discoverTickets = (): string[] => {
  if (!fs.existsSync(GAF)) return [];
  return fs
    .readdirSync(GAF)
    .filter((name) => fs.existsSync(dbPathOf(name)))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
};

export const isKnownTicket = (ticket: string): boolean =>
  /^[A-Za-z0-9_-]+$/.test(ticket) && fs.existsSync(dbPathOf(ticket));

const attempt = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch {
    return fallback;
  }
};

const withStore = <T>(ticket: string, read: (store: Store) => T, fallback: T): T => {
  let store: Store | undefined;
  try {
    store = Store.openReadOnly(dbPathOf(ticket), ticket);
    return read(store);
  } catch {
    return fallback;
  } finally {
    attempt(() => store?.close(), undefined);
  }
};

const emptyCost = (): CostRollup => ({
  ticket: {
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    turns: 0,
    workers: 0,
  },
  stages: Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      { costUsd: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, turns: 0, workers: 0 },
    ]),
  ) as CostRollup["stages"],
  steps: {},
  workers: [],
});

const emptyPipeline = (): PipelineStage[] =>
  STAGES.map((stage) => ({ stage, status: "pending", steps: [] }));

const stageSummary = (stage: PipelineStage): StageSummary => {
  const total = stage.steps.length;
  const done = stage.steps.filter(
    (step) => step.status === "done" || step.status === "skipped",
  ).length;
  return {
    stage: stage.stage,
    status: stage.status,
    progress: total === 0 ? 0 : done / total,
    done,
    total,
  };
};

const stuckLimitMs = (worker: WorkerRow): number =>
  isRunningBash(worker.state, worker.action)
    ? THRESHOLDS.bashStuckAfterMs
    : THRESHOLDS.stuckAfterMs;

const isStuck = (worker: WorkerRow, nowMs: number): boolean =>
  (worker.state === "thinking" || worker.state === "tool") &&
  nowMs - Date.parse(worker.lastActivityAt) >= stuckLimitMs(worker);

export const deriveTicketState = (input: {
  steps: PipelineStep[];
  live: WorkerRow[];
  alive: boolean;
  nowMs: number;
}): TicketState => {
  const { steps, live, alive, nowMs } = input;
  if (steps.length === 0) return alive ? "running" : "idle";
  const statuses = steps.map((step) => step.status);
  const finished = statuses.every((status) => status === "done" || status === "skipped");
  if (finished) return "done";
  const settled: TicketState | undefined = statuses.includes("halted")
    ? "halted"
    : statuses.includes("failed")
      ? "failed"
      : undefined;
  if (!alive) return settled ?? "idle";
  if (live.some((worker) => isStuck(worker, nowMs))) return "stuck";
  const waiting =
    live.some((worker) => WAITING_STATES.includes(worker.state)) ||
    statuses.includes("waiting");
  if (waiting) return "waiting";
  if (settled && !statuses.includes("running")) return settled;
  return "running";
};

const readSummary = (ticket: string, store: Store, nowMs: number): TicketSummary => {
  const pipeline = attempt(() => store.pipeline(), emptyPipeline());
  const workers = attempt(() => store.workers(ticket), []);
  const live = workers.filter(
    (worker) => !ENDED_STATES.includes(worker.state),
  );
  const lease = attempt(() => store.lease(), undefined);
  const heartbeatMs = lease ? nowMs - Date.parse(lease.heartbeatAt) : undefined;
  const alive = heartbeatMs !== undefined && heartbeatMs < LEASE_ALIVE_MS;
  const liveNow = alive ? live.filter((worker) => worker.runId === lease?.runId) : [];
  const steps = pipeline.flatMap((stage) => stage.steps);
  const size = attempt(() => store.size(), undefined);
  const cost = attempt(() => store.costRollup(ticket), emptyCost()).ticket;
  const starts = [
    ...steps.map((step) => step.startedAt),
    ...workers.map((worker) => worker.startedAt),
  ]
    .filter((value): value is string => value !== undefined)
    .sort();
  const ends = [
    ...steps.map((step) => step.endedAt),
    ...workers.map((worker) => worker.endedAt),
  ]
    .filter((value): value is string => value !== undefined)
    .sort();
  const state = deriveTicketState({ steps, live: liveNow, alive, nowMs });
  const startedAt = starts[0] ?? null;
  const endedAt = state === "running" || state === "waiting" || state === "stuck" ? null : (ends[ends.length - 1] ?? null);
  const startMs = startedAt ? Date.parse(startedAt) : nowMs;
  const endMs = endedAt ? Date.parse(endedAt) : nowMs;
  return {
    ticket,
    size: size?.size ?? null,
    sizeReason: size?.reason ?? null,
    state,
    stages: pipeline.map(stageSummary),
    costUsd: cost.costUsd,
    tokens: cost.tokensIn + cost.tokensOut + cost.cacheWrite,
    tokensIn: cost.tokensIn,
    tokensOut: cost.tokensOut,
    liveAgents: liveNow.length,
    openItemCount: attempt(() => store.openHumanItems().length, 0),
    unseenAlerts: attempt(() => store.alerts(ticket, true), []).slice(-20),
    activeRun: alive ? (lease?.runId ?? null) : null,
    heartbeatAgeSec: heartbeatMs === undefined ? null : Math.round(heartbeatMs / 1000),
    startedAt,
    endedAt,
    elapsedMs: Math.max(0, endMs - startMs),
    updatedAt: Date.parse(
      [...starts, ...ends, ...workers.map((worker) => worker.lastEventAt)].sort().pop() ??
        new Date(0).toISOString(),
    ),
  };
};

export const ticketSummary = (ticket: string): TicketSummary | undefined =>
  withStore<TicketSummary | undefined>(
    ticket,
    (store) => readSummary(ticket, store, Date.now()),
    undefined,
  );

export const ticketList = (): TicketSummary[] =>
  discoverTickets()
    .map((ticket) => ticketSummary(ticket))
    .filter((summary): summary is TicketSummary => summary !== undefined);

export const ticketDetail = (ticket: string, sinceIso?: string): TicketDetail | undefined =>
  withStore<TicketDetail | undefined>(
    ticket,
    (store) => {
      const nowMs = Date.now();
      const summary = readSummary(ticket, store, nowMs);
      const since = sinceIso ?? new Date(nowMs - DEFAULT_SAMPLE_WINDOW_MS).toISOString();
      const workers = attempt(() => store.workers(ticket), []);
      const liveWorkerIds = workers
        .filter((worker) => !ENDED_STATES.includes(worker.state))
        .filter((worker) => summary.activeRun !== null && worker.runId === summary.activeRun)
        .map((worker) => worker.id);
      return {
        summary,
        pipeline: attempt(() => store.pipeline(), emptyPipeline()),
        workers,
        liveWorkerIds,
        cost: attempt(() => store.costRollup(ticket), emptyCost()),
        alerts: attempt(() => store.alerts(ticket, false), []),
        decisions: attempt(() => store.decisions(), []),
        items: attempt(() => store.openHumanItems(), []),
        samples: attempt(() => store.samples(ticket, since), []).slice(-MAX_SAMPLES),
        generatedAt: new Date(nowMs).toISOString(),
      };
    },
    undefined,
  );

const stageDuration = (stage: PipelineStage): number => {
  const starts = stage.steps
    .map((step) => (step.startedAt ? Date.parse(step.startedAt) : undefined))
    .filter((value): value is number => value !== undefined);
  const ends = stage.steps
    .map((step) => (step.endedAt ? Date.parse(step.endedAt) : undefined))
    .filter((value): value is number => value !== undefined);
  if (starts.length === 0 || ends.length === 0) return 0;
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
};

export const historyList = (): HistoryEntry[] =>
  discoverTickets()
    .map((ticket) =>
      withStore<HistoryEntry | undefined>(
        ticket,
        (store) => {
          const summary = readSummary(ticket, store, Date.now());
          if (summary.state !== "done") return undefined;
          const pipeline = store.pipeline();
          const durations = Object.fromEntries(
            pipeline.map((stage) => [stage.stage, stageDuration(stage)]),
          ) as Record<Stage, number>;
          return {
            ticket,
            size: summary.size,
            costUsd: summary.costUsd,
            tokens: summary.tokens,
            durationMs: summary.elapsedMs,
            stageDurationsMs: durations,
            endedAt: summary.endedAt,
          };
        },
        undefined,
      ),
    )
    .filter((entry): entry is HistoryEntry => entry !== undefined)
    .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));

export const markSeen = (ticket: string, ids: number[]): void => {
  const store = new Store(dbPathOf(ticket), "");
  try {
    store.markAlertsSeen(ids);
  } finally {
    store.close();
  }
};

export type AnswerResult = "answered" | "already-answered";

export const answerItem = (ticket: string, id: string, text: string): AnswerResult => {
  const store = new Store(dbPathOf(ticket), "");
  try {
    return store.answerQuestion(id, text, "dashboard") ? "answered" : "already-answered";
  } finally {
    store.close();
  }
};

export const itemExists = (ticket: string, id: string): boolean =>
  withStore(ticket, (store) => store.hasHumanItem(id), false);
