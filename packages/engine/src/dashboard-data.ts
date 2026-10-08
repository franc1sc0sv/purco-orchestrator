import { fileDiffOf, filesViewOf, type FileDiff, type FilesView } from "./file-view.ts";
import { storyViewOf, type StoryView } from "./story-view.ts";
import fs from "node:fs";
import path from "node:path";
import {
  buildFailuresView,
  countFailureKinds,
  rawLogOf,
  type FailuresView,
  type KindCount,
} from "./failure-view.ts";
import { buildGrillView, type GrillView } from "./grill-view.ts";
import type { MutantEvent, PlannedMutant } from "./mutant-events.ts";
import {
  Store,
  type OpenHumanItem,
  type StoredAlert,
  type StoredDecision,
  type StoredStreamEvent,
} from "./store.ts";
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
  stageOfKey,
  type NewNote,
  type PipelineStage,
  type PipelineStep,
  type Stage,
  type StepStatus,
  type StoredNote,
} from "./types.ts";

export const GAF =
  process.env.PURCO_GAF ??
  path.join(process.env.HOME ?? "", "projects/purco-projects/general-access-files");

const LEASE_ALIVE_MS = 60_000;
const DEFAULT_SAMPLE_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_SAMPLES = 6000;
const SNAPSHOT_EVENTS = 300;
const DELTA_EVENTS = 500;
const FAILURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const VOLATILE_KEYS = new Set(["generatedAt", "elapsedMs", "heartbeatAgeSec"]);

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
  awaitingGrill: { id: number; question: string } | null;
  recorded: boolean;
  unseenAlerts: StoredAlert[];
  activeRun: string | null;
  heartbeatAgeSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  elapsedMs: number;
  updatedAt: number;
};

export type StreamEvent = {
  seq: number;
  at: string;
  agent: string;
  stage: Stage | null;
  kind: string;
  tool?: string;
  cmd?: string;
  toolUseId?: string;
  why?: string;
  ms?: number;
  ok?: boolean;
  text?: string;
  mutant?: MutantEvent;
};

export type GateMark = { id: string; pass: boolean };

export type TestsView = {
  planned: PlannedMutant[];
  mutants: MutantEvent[];
  gates: GateMark[];
  activity: { at: string; text: string } | null;
  jobs: ForgeJobView[];
};

export type ForgeJobView = {
  id: string;
  kind: string;
  label: string;
  detail: string;
  state: "running" | "done" | "failed";
  workers: number;
  startedAt: string;
  endedAt: string | null;
};

const MAX_FORGE_JOBS = 8;

export type TicketParts = {
  summary: TicketSummary;
  pipeline: PipelineStage[];
  workers: WorkerRow[];
  liveWorkerIds: string[];
  cost: CostRollup;
  alerts: StoredAlert[];
  decisions: StoredDecision[];
  items: OpenHumanItem[];
  grill: GrillView;
  tests: TestsView;
};

export type TicketDetail = TicketParts & {
  samples: (Sample & { id: number })[];
  events: StreamEvent[];
  generatedAt: string;
};

export type TicketDelta = Partial<TicketParts> & {
  samples: (Sample & { id: number })[];
  events: StreamEvent[];
  generatedAt: string;
};

export type StreamState = {
  eventSeq: number;
  sampleId: number;
  signatures: Partial<Record<keyof TicketParts, string>>;
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
    (statuses.includes("waiting") && !statuses.includes("running"));
  if (waiting) return "waiting";
  if (settled && !statuses.includes("running")) return settled;
  return "running";
};

const awaitingGrillOf = (items: OpenHumanItem[]): TicketSummary["awaitingGrill"] => {
  for (const item of items) {
    const payload = item.payload;
    const isGrill =
      typeof payload === "object" && payload !== null && "grill" in payload && payload.grill === true;
    if (isGrill && "id" in payload && typeof payload.id === "number") {
      const question = "question" in payload && typeof payload.question === "string" ? payload.question : item.text;
      return { id: payload.id, question };
    }
  }
  return null;
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
    awaitingGrill: attempt(() => awaitingGrillOf(store.openHumanItems()), null),
    recorded: steps.length > 0,
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

const toStreamEvent = (row: StoredStreamEvent): StreamEvent => {
  const data = parseData(row.data);
  const event: StreamEvent = {
    seq: row.seq,
    at: row.at,
    agent: row.agent,
    stage: stageOfKey(row.phase) ?? null,
    kind: row.kind,
  };
  if (row.kind === "mutant") return { ...event, mutant: data as unknown as MutantEvent };
  if (row.kind === "tool_use" || row.kind === "tool_result" || row.kind === "tool_error") {
    return {
      ...event,
      tool: typeof data.tool === "string" ? data.tool : undefined,
      cmd: typeof data.cmd === "string" ? data.cmd : undefined,
      toolUseId: typeof data.toolUseId === "string" ? data.toolUseId : undefined,
      why: typeof data.why === "string" && data.why.length > 0 ? data.why : undefined,
      ms: typeof data.ms === "number" ? data.ms : undefined,
      ok: typeof data.ok === "boolean" ? data.ok : undefined,
      text: row.kind === "tool_error" ? row.summary : undefined,
    };
  }
  return { ...event, text: row.summary.slice(0, 300) };
};

const parseData = (json: string | null): Record<string, unknown> => {
  if (json === null) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const GATE_MARK = /\b(D\d+)=([TF])\b/g;

const readTests = (store: Store): TestsView => {
  const planned = new Map<number, PlannedMutant>();
  for (const row of store.eventsOfKind("mutant_plan")) {
    const data = parseData(row.data);
    for (const mutant of Array.isArray(data.mutants) ? (data.mutants as PlannedMutant[]) : []) {
      planned.set(mutant.id, mutant);
    }
  }
  const results = new Map<number, MutantEvent>();
  for (const row of store.eventsOfKind("mutant")) {
    const mutant = parseData(row.data) as unknown as MutantEvent;
    results.set(mutant.id, mutant);
  }
  const line = store.latestForgeGateLine() ?? "";
  const note = store.latestForgeNote();
  const jobs = new Map<string, ForgeJobView>();
  for (const row of store.eventsOfKind("forge_job")) {
    const job = parseData(row.data) as unknown as ForgeJobView;
    jobs.set(job.id, job);
  }
  return {
    planned: [...planned.values()].sort((a, b) => a.id - b.id),
    mutants: [...results.values()].sort((a, b) => a.id - b.id),
    gates: [...line.matchAll(GATE_MARK)].map((match) => ({ id: match[1] ?? "", pass: match[2] === "T" })),
    jobs: [...jobs.values()].slice(-MAX_FORGE_JOBS),
    activity: note ? { at: note.at, text: note.summary.replace(/^forge: /, "") } : null,
  };
};

const readParts = (ticket: string, store: Store, nowMs: number): TicketParts => {
  const summary = readSummary(ticket, store, nowMs);
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
    grill: attempt(
      () =>
        buildGrillView({
          pack: path.join(GAF, ticket),
          items: store.grillItems(),
          early: store.earlyAnswers(ticket),
        }),
      { questions: [] },
    ),
    tests: attempt(() => readTests(store), { planned: [], mutants: [], gates: [], activity: null, jobs: [] }),
  };
};

const lastOf = (numbers: number[], fallback: number): number =>
  numbers.length === 0 ? fallback : Math.max(...numbers);

const signatureOf = (value: unknown): string =>
  JSON.stringify(value, (key, nested: unknown) => (VOLATILE_KEYS.has(key) ? undefined : nested));

const signaturesOf = (parts: TicketParts): StreamState["signatures"] =>
  Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, signatureOf(value)]));

export const ticketSnapshot = (
  ticket: string,
  sinceIso?: string,
): { detail: TicketDetail; state: StreamState } | undefined =>
  withStore<{ detail: TicketDetail; state: StreamState } | undefined>(
    ticket,
    (store) => {
      const nowMs = Date.now();
      const parts = readParts(ticket, store, nowMs);
      const since = sinceIso ?? new Date(nowMs - DEFAULT_SAMPLE_WINDOW_MS).toISOString();
      const samples = attempt(() => store.samples(ticket, since), []).slice(-MAX_SAMPLES);
      const events = attempt(() => store.recentStreamEvents(SNAPSHOT_EVENTS), []).map(toStreamEvent);
      const state: StreamState = {
        eventSeq: lastOf(events.map((event) => event.seq), 0),
        sampleId: lastOf(
          samples.map((sample) => sample.id),
          attempt(() => store.lastSampleId(ticket), 0),
        ),
        signatures: signaturesOf(parts),
      };
      return {
        detail: { ...parts, samples, events, generatedAt: new Date(nowMs).toISOString() },
        state,
      };
    },
    undefined,
  );

export const ticketDelta = (
  ticket: string,
  previous: StreamState,
): { delta: TicketDelta; state: StreamState } | undefined =>
  withStore<{ delta: TicketDelta; state: StreamState } | undefined>(
    ticket,
    (store) => {
      const nowMs = Date.now();
      const parts = readParts(ticket, store, nowMs);
      const signatures = signaturesOf(parts);
      const changed = Object.fromEntries(
        Object.entries(parts).filter(
          ([key]) => signatures[key as keyof TicketParts] !== previous.signatures[key as keyof TicketParts],
        ),
      );
      const events = store.streamEventsAfter(previous.eventSeq, DELTA_EVENTS).map(toStreamEvent);
      const samples = store.samplesAfter(ticket, previous.sampleId);
      const state: StreamState = {
        eventSeq: lastOf(events.map((event) => event.seq), previous.eventSeq),
        sampleId: lastOf(
          samples.map((sample) => sample.id),
          previous.sampleId,
        ),
        signatures,
      };
      const unchanged =
        Object.keys(changed).length === 0 && events.length === 0 && samples.length === 0;
      if (unchanged) return undefined;
      return {
        delta: { ...changed, samples, events, generatedAt: new Date(nowMs).toISOString() },
        state,
      };
    },
    undefined,
  );

export const ticketDetail = (ticket: string, sinceIso?: string): TicketDetail | undefined =>
  ticketSnapshot(ticket, sinceIso)?.detail;

const failureKinds = (): KindCount[] => {
  const counts = new Map<string, KindCount>();
  const since = Date.now() - FAILURE_WINDOW_MS;
  for (const ticket of discoverTickets()) {
    withStore(ticket, (store) => countFailureKinds(store, ticket, since, counts), undefined);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
};

export const ticketFailures = (ticket: string): FailuresView | undefined =>
  withStore<FailuresView | undefined>(
    ticket,
    (store) => buildFailuresView(ticket, store, failureKinds()),
    undefined,
  );

const MAX_TIMELINE_TICKS = 20000;
const MAX_REPLAY_EVENTS = 500;

export const ticketToolTicks = (ticket: string): { agent: string; at: string }[] =>
  withStore(ticket, (store) => store.toolTicks(MAX_TIMELINE_TICKS), []);

export const ticketEventsUntil = (ticket: string, until: string): StreamEvent[] =>
  withStore(ticket, (store) => store.streamEventsUntil(until, MAX_REPLAY_EVENTS).map(toStreamEvent), []);

export const ticketStory = (ticket: string): StoryView | undefined =>
  withStore<StoryView | undefined>(ticket, (store) => storyViewOf(store), undefined);

export const ticketFiles = (ticket: string): FilesView | undefined =>
  withStore<FilesView | undefined>(ticket, (store) => filesViewOf(store), undefined);

export const ticketFileDiff = (ticket: string, file: string): FileDiff | undefined =>
  withStore<FileDiff | undefined>(ticket, (store) => fileDiffOf(store, file), undefined);

export const ticketNotes = (ticket: string): StoredNote[] =>
  withStore<StoredNote[]>(ticket, (store) => store.notes(), []);

export const addTicketNote = (ticket: string, note: NewNote): number => {
  const store = new Store(dbPathOf(ticket), "");
  try {
    store.bindTicket(ticket);
    return store.addNote(note);
  } finally {
    store.close();
  }
};

export const ticketRawLog = (ticket: string, agent: string): string =>
  withStore(ticket, (store) => rawLogOf(store, agent), "");

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

export const answerEarly = (ticket: string, qid: number, text: string): AnswerResult => {
  const store = new Store(dbPathOf(ticket), "");
  try {
    const asked = store.grillItems().some((item) => {
      const payload = item.payload;
      return typeof payload === "object" && payload !== null && "id" in payload && payload.id === qid;
    });
    if (asked) return "already-answered";
    return store.saveEarlyAnswer(ticket, qid, text) ? "answered" : "already-answered";
  } finally {
    store.close();
  }
};

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
