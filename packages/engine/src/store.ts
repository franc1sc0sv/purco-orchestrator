import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fallbackTitle } from "./alert-title.ts";
import type { Size } from "./size.ts";
import {
  ENDED_STATES,
  burnTokens,
  rollupCosts,
  type CostRollup,
  type Sample,
  type WorkerRow,
} from "./telemetry.ts";
import {
  STAGES,
  stageOfKey,
  type AppliedNote,
  type ChangeSnapshot,
  type Finding,
  type FindingStatus,
  type PipelineStage,
  type PipelineStep,
  type ScratchpadEvent,
  type Site,
  type SiteState,
  type NewNote,
  type NoteStatus,
  type Stage,
  type Story,
  type StepResult,
  type StepStatus,
  type StoredNote,
  type StoredPhase,
  type TicketKind,
  type StoredQuestion,
} from "./types.ts";

export type LeaseRow = {
  ticket: string;
  runId: string;
  pid: number;
  host: string;
  heartbeatAt: string;
  startedAt: string;
};

export type LeaseTake =
  | { ok: true; stolenFrom?: LeaseRow }
  | { ok: false; held: LeaseRow };

export type StoredStep = {
  key: string;
  stage: Stage;
  status: StepStatus;
  startedAt?: string;
  result?: StepResult;
};

export type StoredStepRow = {
  key: string;
  baseKey: string;
  attempt: number;
  stage: Stage;
  status: StepStatus;
  reason: string | null;
  startedAt: string | null;
  endedAt: string | null;
};

export type StoredEarlyAnswer = { qid: number; answer: string; at: string };

export type StoredGrillItem = {
  id: string;
  question: string;
  answer: string | null;
  answeredAt: string | null;
  answeredVia: string | null;
  answeredBy: string | null;
  payload: unknown;
};

export type StoredStreamEvent = {
  seq: number;
  at: string;
  agent: string;
  phase: string;
  kind: string;
  summary: string;
  data: string | null;
};

export type DecisionInput = {
  step: string;
  kind: string;
  subjects: string[];
  question: string;
  brief: string;
  decision: string;
  text: string;
};

export type StoredDecision = DecisionInput & {
  id: number;
  runId: string;
  at: string;
};

export type OpenHumanItem = {
  id: string;
  kind: string;
  text: string;
  from: string;
  at: string;
  payload: unknown;
};

const parsePayload = (json: string | null): unknown => {
  if (json === null) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

export const ALERT_KINDS = [
  "gate",
  "question",
  "sign",
  "stuck",
  "loop",
  "burn",
  "halted",
  "done",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertInput = {
  runId: string;
  workerId?: string;
  step: string;
  kind: AlertKind;
  message: string;
  title: string;
  dedupeKey?: string;
};

export type StoredAlert = {
  id: number;
  ticket: string;
  runId: string;
  workerId?: string;
  step: string;
  kind: AlertKind;
  message: string;
  title: string;
  at: string;
  seen: number;
};

type WorkerRecord = Omit<WorkerRow, "filesRead" | "filesWritten" | "stage" | "endedAt" | "haltReason"> & {
  stage: string | null;
  endedAt: string | null;
  haltReason: string | null;
  filesRead: string;
  filesWritten: string;
};

const WORKER_COLUMNS = `id, ticket, run_id as runId, step, stage, label, role, model, state,
  action, tokens_in as tokensIn, tokens_out as tokensOut, cache_read as cacheRead,
  cache_write as cacheWrite, cost_usd as costUsd, turns, max_turns as maxTurns,
  context_tokens as contextTokens, files_read as filesRead,
  files_written as filesWritten, started_at as startedAt,
  last_event_at as lastEventAt, last_activity_at as lastActivityAt,
  ended_at as endedAt, halt_reason as haltReason`;

const toWorkerRow = (record: WorkerRecord): WorkerRow => {
  const { stage, endedAt, haltReason, filesRead, filesWritten, ...rest } = record;
  return {
    ...rest,
    stage: (stage ?? undefined) as WorkerRow["stage"],
    endedAt: endedAt ?? undefined,
    haltReason: haltReason ?? undefined,
    filesRead: JSON.parse(filesRead),
    filesWritten: JSON.parse(filesWritten),
  };
};

const SCHEMA = `
create table if not exists runs (
  run_id     text primary key,
  ticket     text not null,
  started_at text not null,
  ended_at   text,
  status     text not null default 'running'
);

create table if not exists phases (
  run_id     text not null,
  phase      text not null,
  agent      text,
  status     text,
  summary    text,
  cost_usd   real default 0,
  turns      integer default 0,
  tokens_in         integer default 0,
  tokens_out        integer default 0,
  tokens_cache_read integer default 0,
  tokens_cache_write integer default 0,
  model      text,
  started_at text,
  ended_at   text,
  primary key (run_id, phase)
);

create table if not exists events (
  run_id  text not null,
  seq     integer not null,
  at      text not null,
  agent   text not null,
  phase   text not null,
  kind    text not null,
  summary text not null,
  data    text,
  primary key (run_id, seq)
);

create table if not exists questions (
  id          text primary key,
  run_id      text not null,
  at          text not null,
  from_agent  text not null,
  phase       text not null,
  level       text not null,
  question    text not null,
  answer      text,
  answered_at text,
  answered_by text
);

create table if not exists sites (
  id         integer primary key autoincrement,
  run_id     text not null,
  path       text not null,
  axis       text not null,
  touches_ba integer not null,
  touches_ip integer not null,
  has_flag   integer not null,
  is_writer  integer not null,
  cluster    text,
  state      text not null default 'untriaged',
  hits       integer not null default 1,
  reached_via text,
  unique (run_id, path, axis)
);

create table if not exists findings (
  id                text primary key,
  run_id            text not null,
  site_id           integer,
  operation         text not null,
  claim             text not null,
  behavior_flag_on  text,
  behavior_flag_off text,
  target_state      text,
  severity          text not null,
  status            text not null default 'found',
  verdict           text,
  evidence          text,
  found_by          text,
  verified_by       text,
  at                text not null
);

create table if not exists steps (
  ticket      text not null,
  step        text not null,
  run_id      text not null,
  stage       text not null,
  base_key    text not null,
  attempt     integer not null default 1,
  seq         integer not null,
  status      text not null default 'pending',
  before_wait text,
  reason      text,
  started_at  text,
  ended_at    text,
  result      text,
  primary key (ticket, step)
);

create table if not exists leases (
  ticket       text primary key,
  run_id       text not null,
  pid          integer not null,
  host         text not null,
  heartbeat_at text not null,
  started_at   text not null
);

create table if not exists decisions (
  id       integer primary key autoincrement,
  ticket   text not null,
  run_id   text not null,
  step     text not null,
  kind     text not null,
  subjects text not null,
  question text not null,
  brief    text not null,
  decision text not null,
  text     text not null,
  at       text not null
);

create table if not exists tickets (
  ticket      text primary key,
  size        text,
  size_reason text,
  updated_at  text
);

create table if not exists workers (
  id               text primary key,
  ticket           text not null,
  run_id           text not null,
  step             text not null,
  stage            text,
  label            text not null,
  role             text not null,
  model            text not null,
  state            text not null,
  action           text not null default '',
  tokens_in        integer not null default 0,
  tokens_out       integer not null default 0,
  cache_read       integer not null default 0,
  cache_write      integer not null default 0,
  cost_usd         real not null default 0,
  turns            integer not null default 0,
  max_turns        integer not null default 0,
  context_tokens   integer not null default 0,
  files_read       text not null default '[]',
  files_written    text not null default '[]',
  started_at       text not null,
  last_event_at    text not null,
  last_activity_at text not null,
  ended_at         text,
  halt_reason      text
);

create table if not exists samples (
  id        integer primary key autoincrement,
  worker_id text not null,
  ticket    text not null,
  at        text not null,
  tokens    integer not null,
  cost_usd  real not null
);

create table if not exists alerts (
  id         integer primary key autoincrement,
  ticket     text not null,
  run_id     text not null,
  worker_id  text,
  step       text not null,
  kind       text not null,
  message    text not null,
  title      text,
  at         text not null,
  seen       integer not null default 0,
  dedupe_key text
);

create table if not exists early_answers (
  ticket text not null,
  qid    integer not null,
  answer text not null,
  at     text not null,
  primary key (ticket, qid)
);

create table if not exists notes (
  id           integer primary key autoincrement,
  ticket       text not null,
  target_agent text,
  file         text,
  line         integer,
  text         text not null,
  status       text not null default 'queued',
  reply        text,
  created_at   text not null,
  seen_at      text,
  applied_at   text,
  via          text not null default 'dashboard'
);

create index if not exists notes_ticket_idx on notes (ticket, status);

create unique index if not exists alerts_dedupe_idx on alerts (run_id, dedupe_key) where dedupe_key is not null;
create index if not exists alerts_ticket_idx on alerts (ticket, seen, id);
create index if not exists workers_ticket_idx on workers (ticket, state);
create index if not exists samples_ticket_idx on samples (ticket, at);
create index if not exists decisions_ticket_idx on decisions (ticket, id);
create index if not exists sites_state_idx on sites (run_id, state);
create index if not exists sites_axis_idx on sites (run_id, axis);
create index if not exists findings_status_idx on findings (run_id, status);
create index if not exists questions_open_idx on questions (run_id, answered_at);
`;

const bool = (value: boolean): number => (value ? 1 : 0);

const splitAttempt = (key: string): { baseKey: string; attempt: number } => {
  const match = /^(.*)#(\d+)$/.exec(key);
  return match
    ? { baseKey: match[1] ?? key, attempt: Number(match[2]) }
    : { baseKey: key, attempt: 1 };
};

const stepStatusOf = (outcomeStatus: string): StepStatus => {
  if (outcomeStatus === "done") return "done";
  if (outcomeStatus === "skipped") return "skipped";
  return "failed";
};

const stageStatus = (statuses: StepStatus[]): StepStatus => {
  if (statuses.length === 0) return "pending";
  for (const status of ["running", "waiting", "halted", "failed"] as const) {
    if (statuses.includes(status)) return status;
  }
  if (statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.every((status) => status === "done" || status === "skipped")) return "done";
  return statuses.includes("done") ? "running" : "pending";
};

export class Store {
  private readonly db: DatabaseSync;
  private readonly runId: string;
  private boundTicket: string | undefined;

  static openReadOnly(dbPath: string, ticket: string): Store {
    return new Store(dbPath, "", { readOnly: true, ticket });
  }

  constructor(
    dbPath: string,
    runId: string,
    options: { readOnly: true; ticket: string } | undefined = undefined,
  ) {
    if (options) {
      this.db = new DatabaseSync(dbPath, { readOnly: true });
      this.db.exec("pragma busy_timeout = 2000");
      this.runId = runId;
      this.boundTicket = options.ticket;
      return;
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("pragma journal_mode = wal");
    this.db.exec("pragma busy_timeout = 5000");
    this.db.exec(SCHEMA);
    this.addMissingColumns();
    this.runId = runId;
  }

  private addMissingColumns(): void {
    const wanted: Record<string, Record<string, string>> = {
      phases: {
        tokens_in: "integer default 0",
        tokens_out: "integer default 0",
        tokens_cache_read: "integer default 0",
        tokens_cache_write: "integer default 0",
        model: "text",
      },
      questions: {
        payload_json: "text",
        answered_via: "text",
      },
      alerts: {
        title: "text",
      },
      tickets: {
        kind: "text",
        story_json: "text",
        worktree: "text",
        changes_json: "text",
      },
    };
    for (const [table, columns] of Object.entries(wanted)) {
      const existing = new Set(
        this.db
          .prepare(`select name from pragma_table_info('${table}')`)
          .all()
          .map((row) => String((row as { name: unknown }).name)),
      );
      for (const [column, type] of Object.entries(columns)) {
        if (existing.has(column)) continue;
        this.db.exec(`alter table ${table} add column ${column} ${type}`);
      }
    }
  }

  startRun(ticket: string): void {
    this.boundTicket = ticket;
    this.db
      .prepare(
        `insert into runs (run_id, ticket, started_at) values (?, ?, ?)
         on conflict (run_id) do update
           set ticket = excluded.ticket, ended_at = null, status = 'running'`,
      )
      .run(this.runId, ticket, new Date().toISOString());
    this.haltOrphanWorkers();
  }

  private haltOrphanWorkers(): void {
    const ended = ENDED_STATES.map((state) => `'${state}'`).join(", ");
    this.db
      .prepare(
        `update workers
            set state = 'halted', action = '', ended_at = ?,
                halt_reason = 'the run process stopped before this worker ended'
          where run_id = ? and state not in (${ended})`,
      )
      .run(new Date().toISOString(), this.runId);
  }

  endRun(status: string): void {
    this.db
      .prepare("update runs set ended_at = ?, status = ? where run_id = ?")
      .run(new Date().toISOString(), status, this.runId);
  }

  recordEvent(event: ScratchpadEvent): void {
    this.db
      .prepare(
        `insert into events (run_id, seq, at, agent, phase, kind, summary, data)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (run_id, seq) do nothing`,
      )
      .run(
        event.runId,
        event.seq,
        event.at,
        event.agent,
        event.phase,
        event.kind,
        event.summary,
        event.data ? JSON.stringify(event.data) : null,
      );
  }

  startPhase(phase: string, agent: string): void {
    this.stepRunning(phase);
    this.db
      .prepare(
        `insert into phases (run_id, phase, agent, status, started_at)
         values (?, ?, ?, 'running', ?)
         on conflict (run_id, phase) do update
           set agent = excluded.agent, status = 'running',
               started_at = excluded.started_at`,
      )
      .run(this.runId, phase, agent, new Date().toISOString());
  }

  endPhase(input: {
    phase: string;
    status: string;
    summary: string;
    costUsd: number;
    turns: number;
    tokensIn: number;
    tokensOut: number;
    tokensCacheRead: number;
    tokensCacheWrite: number;
    model?: string;
  }): void {
    this.stepEnded(input.phase, input.status, input.summary);
    this.db
      .prepare(
        `update phases
            set status = ?, summary = ?, cost_usd = ?, turns = ?,
                tokens_in = ?, tokens_out = ?,
                tokens_cache_read = ?, tokens_cache_write = ?,
                model = ?, ended_at = ?
          where run_id = ? and phase = ?`,
      )
      .run(
        input.status,
        input.summary,
        input.costUsd,
        input.turns,
        input.tokensIn,
        input.tokensOut,
        input.tokensCacheRead,
        input.tokensCacheWrite,
        input.model ?? null,
        new Date().toISOString(),
        this.runId,
        input.phase,
      );
  }

  bindTicket(ticket: string): void {
    this.boundTicket = ticket;
  }

  private ticketName(): string {
    if (this.boundTicket) return this.boundTicket;
    const row = this.db
      .prepare("select ticket from runs where run_id = ?")
      .get(this.runId) as { ticket: string } | undefined;
    return row?.ticket ?? "";
  }

  registerSteps(keys: string[]): void {
    const ticket = this.ticketName();
    const insert = this.db.prepare(
      `insert or ignore into steps
         (ticket, step, run_id, stage, base_key, attempt, seq, status)
       values (?, ?, ?, ?, ?, ?, (select coalesce(max(seq), 0) + 1 from steps where ticket = ?), 'pending')`,
    );
    for (const key of keys) {
      const stage = stageOfKey(key);
      if (!stage) continue;
      const { baseKey, attempt } = splitAttempt(key);
      insert.run(ticket, key, this.runId, stage, baseKey, attempt, ticket);
    }
  }

  removeStep(key: string): void {
    this.db
      .prepare("delete from steps where ticket = ? and step = ? and status = 'pending'")
      .run(this.ticketName(), key);
  }

  private stepRunning(key: string): void {
    const stage = stageOfKey(key);
    if (!stage) return;
    const ticket = this.ticketName();
    const { baseKey, attempt } = splitAttempt(key);
    this.db
      .prepare(
        `insert into steps
           (ticket, step, run_id, stage, base_key, attempt, seq, status, started_at)
         values (?, ?, ?, ?, ?, ?, (select coalesce(max(seq), 0) + 1 from steps where ticket = ?), 'running', ?)
         on conflict (ticket, step) do update
           set run_id = excluded.run_id, status = 'running',
               started_at = excluded.started_at, ended_at = null,
               reason = null, result = null, before_wait = null`,
      )
      .run(ticket, key, this.runId, stage, baseKey, attempt, ticket, new Date().toISOString());
  }

  private stepEnded(key: string, outcomeStatus: string, summary: string): void {
    if (!stageOfKey(key)) return;
    const status = stepStatusOf(outcomeStatus);
    this.db
      .prepare(
        `update steps
            set status = ?, reason = ?, ended_at = ?, before_wait = null
          where ticket = ? and step = ?`,
      )
      .run(
        status,
        status === "done" ? null : summary.slice(0, 300),
        new Date().toISOString(),
        this.ticketName(),
        key,
      );
  }

  haltStep(key: string, reason: string): void {
    if (!stageOfKey(key)) return;
    this.db
      .prepare(
        `update steps set status = 'halted', reason = ?, before_wait = null
          where ticket = ? and step = ?`,
      )
      .run(reason.slice(0, 300), this.ticketName(), key);
  }

  setWaiting(key: string, waiting: boolean): void {
    const ticket = this.ticketName();
    if (waiting) {
      this.db
        .prepare(
          `update steps set before_wait = status, status = 'waiting'
            where ticket = ? and step = ? and status != 'waiting'`,
        )
        .run(ticket, key);
      return;
    }
    this.db
      .prepare(
        `update steps set status = before_wait, before_wait = null
          where ticket = ? and step = ? and status = 'waiting' and before_wait is not null`,
      )
      .run(ticket, key);
  }

  noteStep(key: string, note: string): void {
    this.db
      .prepare(
        "update steps set reason = ? where ticket = ? and step = ? and status = 'running'",
      )
      .run(note.slice(0, 300), this.ticketName(), key);
  }

  recordResult(key: string, result: StepResult): void {
    this.db
      .prepare("update steps set result = ? where ticket = ? and step = ?")
      .run(JSON.stringify(result), this.ticketName(), key);
  }

  stepResult(key: string): StepResult | undefined {
    const row = this.db
      .prepare("select result from steps where ticket = ? and step = ?")
      .get(this.ticketName(), key) as { result: string | null } | undefined;
    return row?.result ? JSON.parse(row.result) : undefined;
  }

  stageSteps(stage: Stage): StoredStep[] {
    const rows = this.db
      .prepare(
        `select step, stage, status, started_at as startedAt, result
           from steps where ticket = ? and stage = ? order by seq`,
      )
      .all(this.ticketName(), stage) as unknown as {
      step: string;
      stage: Stage;
      status: StepStatus;
      startedAt: string | null;
      result: string | null;
    }[];
    return rows.map((row) => ({
      key: row.step,
      stage: row.stage,
      status: row.status,
      startedAt: row.startedAt ?? undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
    }));
  }

  pipeline(): PipelineStage[] {
    const rows = this.db
      .prepare(
        `select step as key, base_key as baseKey, attempt, stage, status,
                reason, started_at as startedAt, ended_at as endedAt
           from steps where ticket = ? order by seq`,
      )
      .all(this.ticketName()) as unknown as (PipelineStep & { stage: Stage })[];
    return STAGES.map((stage) => {
      const latest = new Map<string, PipelineStep>();
      for (const row of rows) {
        if (row.stage !== stage) continue;
        const known = latest.get(row.baseKey);
        if (known && known.attempt > row.attempt) continue;
        latest.set(row.baseKey, {
          key: row.key,
          baseKey: row.baseKey,
          attempt: row.attempt,
          status: row.status,
          reason: row.reason ?? undefined,
          startedAt: row.startedAt ?? undefined,
          endedAt: row.endedAt ?? undefined,
        });
      }
      const steps = [...latest.values()];
      return { stage, status: stageStatus(steps.map((step) => step.status)), steps };
    });
  }

  setSize(size: Size, reason: string): void {
    this.db
      .prepare(
        `insert into tickets (ticket, size, size_reason, updated_at) values (?, ?, ?, ?)
         on conflict (ticket) do update
           set size = excluded.size, size_reason = excluded.size_reason,
               updated_at = excluded.updated_at`,
      )
      .run(this.ticketName(), size, reason, new Date().toISOString());
  }

  size(): { size: Size; reason: string } | undefined {
    const row = this.db
      .prepare("select size, size_reason as reason from tickets where ticket = ?")
      .get(this.ticketName()) as { size: Size | null; reason: string | null } | undefined;
    return row?.size ? { size: row.size, reason: row.reason ?? "" } : undefined;
  }

  setKind(kind: TicketKind): void {
    this.setTicketColumn("kind", kind);
  }

  setStory(story: Story): void {
    this.setTicketColumn("story_json", JSON.stringify(story));
  }

  setWorktree(worktree: string): void {
    this.setTicketColumn("worktree", worktree);
  }

  setChanges(changes: ChangeSnapshot): void {
    this.setTicketColumn("changes_json", JSON.stringify(changes));
  }

  private setTicketColumn(column: "kind" | "story_json" | "worktree" | "changes_json", value: string): void {
    this.db
      .prepare(
        `insert into tickets (ticket, ${column}, updated_at) values (?, ?, ?)
         on conflict (ticket) do update set ${column} = excluded.${column}, updated_at = excluded.updated_at`,
      )
      .run(this.ticketName(), value, new Date().toISOString());
  }

  storyRow(): { kind?: TicketKind; story?: Story; worktree?: string; changes?: ChangeSnapshot } {
    const column = (name: string): string => (this.hasColumn("tickets", name) ? name : `null as ${name}`);
    const row = this.db
      .prepare(
        `select ${column("kind")}, ${column("story_json")}, ${column("worktree")}, ${column("changes_json")}
           from tickets where ticket = ?`,
      )
      .get(this.ticketName()) as
      | { kind: TicketKind | null; story_json: string | null; worktree: string | null; changes_json: string | null }
      | undefined;
    return {
      kind: row?.kind ?? undefined,
      story: row?.story_json ? JSON.parse(row.story_json) : undefined,
      worktree: row?.worktree ?? undefined,
      changes: row?.changes_json ? JSON.parse(row.changes_json) : undefined,
    };
  }

  takeLease(
    input: { pid: number; host: string; now: Date },
    mayTake: (held: LeaseRow) => boolean,
  ): LeaseTake {
    const ticket = this.ticketName();
    this.db.exec("begin immediate");
    try {
      const held = this.readLease(ticket);
      if (held && !mayTake(held)) {
        this.db.exec("rollback");
        return { ok: false, held };
      }
      const at = input.now.toISOString();
      if (held && held.runId !== this.runId) {
        this.db
          .prepare(
            "update runs set status = 'dead', ended_at = ? where run_id = ? and status = 'running'",
          )
          .run(at, held.runId);
        this.db
          .prepare(
            "update steps set status = 'halted', reason = 'the run that owned this step stopped' where run_id = ? and status = 'running'",
          )
          .run(held.runId);
      }
      this.db
        .prepare(
          `insert into leases (ticket, run_id, pid, host, heartbeat_at, started_at)
           values (?, ?, ?, ?, ?, ?)
           on conflict (ticket) do update
             set run_id = excluded.run_id, pid = excluded.pid, host = excluded.host,
                 heartbeat_at = excluded.heartbeat_at, started_at = excluded.started_at`,
        )
        .run(ticket, this.runId, input.pid, input.host, at, at);
      this.db.exec("commit");
      return held ? { ok: true, stolenFrom: held } : { ok: true };
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  private readLease(ticket: string): LeaseRow | undefined {
    return this.db
      .prepare(
        `select ticket, run_id as runId, pid, host, heartbeat_at as heartbeatAt,
                started_at as startedAt
           from leases where ticket = ?`,
      )
      .get(ticket) as unknown as LeaseRow | undefined;
  }

  lease(): LeaseRow | undefined {
    return this.readLease(this.ticketName());
  }

  heartbeat(at: Date): void {
    this.db
      .prepare("update leases set heartbeat_at = ? where ticket = ? and run_id = ?")
      .run(at.toISOString(), this.ticketName(), this.runId);
  }

  releaseLease(): void {
    this.db
      .prepare("delete from leases where ticket = ? and run_id = ?")
      .run(this.ticketName(), this.runId);
  }

  recordDecision(input: DecisionInput): number {
    const result = this.db
      .prepare(
        `insert into decisions
           (ticket, run_id, step, kind, subjects, question, brief, decision, text, at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.ticketName(),
        this.runId,
        input.step,
        input.kind,
        JSON.stringify(input.subjects),
        input.question,
        input.brief,
        input.decision,
        input.text,
        new Date().toISOString(),
      );
    return Number(result.lastInsertRowid);
  }

  decisions(): StoredDecision[] {
    const rows = this.db
      .prepare(
        `select id, run_id as runId, step, kind, subjects, question, brief,
                decision, text, at
           from decisions where ticket = ? order by id`,
      )
      .all(this.ticketName()) as unknown as (Omit<StoredDecision, "subjects"> & {
      subjects: string;
    })[];
    return rows.map((row) => ({ ...row, subjects: JSON.parse(row.subjects) }));
  }

  saveWorker(row: WorkerRow): void {
    this.db
      .prepare(
        `insert into workers
           (id, ticket, run_id, step, stage, label, role, model, state, action,
            tokens_in, tokens_out, cache_read, cache_write, cost_usd, turns,
            max_turns, context_tokens, files_read, files_written, started_at,
            last_event_at, last_activity_at, ended_at, halt_reason)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update
           set state = excluded.state, action = excluded.action, model = excluded.model,
               tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out,
               cache_read = excluded.cache_read, cache_write = excluded.cache_write,
               cost_usd = excluded.cost_usd, turns = excluded.turns,
               max_turns = excluded.max_turns, context_tokens = excluded.context_tokens,
               files_read = excluded.files_read, files_written = excluded.files_written,
               started_at = excluded.started_at, last_event_at = excluded.last_event_at,
               last_activity_at = excluded.last_activity_at, ended_at = excluded.ended_at,
               halt_reason = excluded.halt_reason`,
      )
      .run(
        row.id,
        row.ticket,
        row.runId,
        row.step,
        row.stage ?? null,
        row.label,
        row.role,
        row.model,
        row.state,
        row.action,
        row.tokensIn,
        row.tokensOut,
        row.cacheRead,
        row.cacheWrite,
        row.costUsd,
        row.turns,
        row.maxTurns,
        row.contextTokens,
        JSON.stringify(row.filesRead),
        JSON.stringify(row.filesWritten),
        row.startedAt,
        row.lastEventAt,
        row.lastActivityAt,
        row.endedAt ?? null,
        row.haltReason ?? null,
      );
  }

  recordSample(sample: Sample & { ticket: string }): void {
    this.db
      .prepare(
        "insert into samples (worker_id, ticket, at, tokens, cost_usd) values (?, ?, ?, ?, ?)",
      )
      .run(sample.workerId, sample.ticket, sample.at, sample.tokens, sample.costUsd);
  }

  workers(ticket: string): WorkerRow[] {
    const rows = this.db
      .prepare(`select ${WORKER_COLUMNS} from workers where ticket = ? order by started_at, id`)
      .all(ticket) as unknown as WorkerRecord[];
    return rows.map(toWorkerRow);
  }

  liveWorkers(ticket: string): WorkerRow[] {
    const ended = ENDED_STATES.map((state) => `'${state}'`).join(", ");
    const rows = this.db
      .prepare(
        `select ${WORKER_COLUMNS} from workers
          where ticket = ? and state not in (${ended})
            and run_id in (select run_id from runs where status = 'running')
          order by started_at, id`,
      )
      .all(ticket) as unknown as WorkerRecord[];
    return rows.map(toWorkerRow);
  }

  samples(ticket: string, sinceIso: string): (Sample & { id: number })[] {
    return this.db
      .prepare(
        `select id, worker_id as workerId, at, tokens, cost_usd as costUsd
           from samples where ticket = ? and at >= ? order by at, id`,
      )
      .all(ticket, sinceIso) as unknown as (Sample & { id: number })[];
  }

  costRollup(ticket: string): CostRollup {
    return rollupCosts(this.workers(ticket));
  }

  finishedRates(role: string): number[] {
    const rows = this.db
      .prepare(
        `select tokens_in as tokensIn, tokens_out as tokensOut, cache_write as cacheWrite,
                started_at as startedAt, ended_at as endedAt
           from workers where role = ? and state = 'done' and ended_at is not null`,
      )
      .all(role) as unknown as {
      tokensIn: number;
      tokensOut: number;
      cacheWrite: number;
      startedAt: string;
      endedAt: string;
    }[];
    const rates: number[] = [];
    for (const row of rows) {
      const minutes = (Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 60_000;
      if (minutes <= 0) continue;
      const tokens = burnTokens({
        input: row.tokensIn,
        output: row.tokensOut,
        cacheRead: 0,
        cacheCreation: row.cacheWrite,
      });
      rates.push(tokens / minutes);
    }
    return rates;
  }

  raiseAlert(input: AlertInput): { id: number; inserted: boolean } {
    const result = this.db
      .prepare(
        `insert or ignore into alerts
           (ticket, run_id, worker_id, step, kind, message, title, at, dedupe_key)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.ticketName(),
        input.runId,
        input.workerId ?? null,
        input.step,
        input.kind,
        input.message,
        input.title,
        new Date().toISOString(),
        input.dedupeKey ?? null,
      );
    return { id: Number(result.lastInsertRowid), inserted: Number(result.changes) > 0 };
  }

  private hasAlertTitles(): boolean {
    return this.db.prepare("select 1 from pragma_table_info('alerts') where name = 'title'").get() !== undefined;
  }

  alerts(ticket: string, unseenOnly: boolean): StoredAlert[] {
    const titleColumn = this.hasAlertTitles() ? "title" : "null as title";
    const rows = this.db
      .prepare(
        `select id, ticket, run_id as runId, worker_id as workerId, step, kind,
                message, ${titleColumn}, at, seen
           from alerts where ticket = ?${unseenOnly ? " and seen = 0" : ""} order by id`,
      )
      .all(ticket) as unknown as (Omit<StoredAlert, "workerId" | "title"> & {
      workerId: string | null;
      title: string | null;
    })[];
    return rows.map((row) => ({
      ...row,
      workerId: row.workerId ?? undefined,
      title: row.title ?? fallbackTitle(row.message),
    }));
  }

  markAlertsSeen(ids: number[]): void {
    const update = this.db.prepare("update alerts set seen = 1 where id = ?");
    for (const id of ids) update.run(id);
  }

  openItems(): StoredQuestion[] {
    return this.db
      .prepare(
        `select id, from_agent as fromAgent, phase, level, question, at
           from questions where answered_at is null order by at`,
      )
      .all() as unknown as StoredQuestion[];
  }

  completedPhases(): string[] {
    return this.db
      .prepare(
        "select phase from phases where run_id = ? and status = 'done' order by started_at",
      )
      .all(this.runId)
      .map((row) => String((row as { phase: unknown }).phase));
  }

  askQuestion(
    id: string,
    fromAgent: string,
    phase: string,
    level: string,
    question: string,
    payload?: unknown,
  ): void {
    this.db
      .prepare(
        `insert into questions (id, run_id, at, from_agent, phase, level, question, payload_json)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.runId,
        new Date().toISOString(),
        fromAgent,
        phase,
        level,
        question,
        payload === undefined ? null : JSON.stringify(payload),
      );
  }

  answerQuestion(id: string, answer: string, answeredBy: string): boolean {
    const result = this.db
      .prepare(
        `update questions set answer = ?, answered_at = ?, answered_by = ?, answered_via = ?
          where id = ? and answered_at is null`,
      )
      .run(
        answer,
        new Date().toISOString(),
        answeredBy,
        answeredBy === "dashboard" ? "dashboard" : "cli",
        id,
      );
    return Number(result.changes) > 0;
  }

  addNote(note: NewNote): number {
    const result = this.db
      .prepare(
        `insert into notes (ticket, target_agent, file, line, text, status, created_at, via)
         values (?, ?, ?, ?, ?, 'queued', ?, ?)`,
      )
      .run(
        this.ticketName(),
        note.targetAgent ?? null,
        note.file ?? null,
        note.line ?? null,
        note.text,
        new Date().toISOString(),
        note.via,
      );
    return Number(result.lastInsertRowid);
  }

  notes(status?: NoteStatus): StoredNote[] {
    if (!this.hasTable("notes")) return [];
    const rows = this.db
      .prepare(
        `select id, ticket, target_agent as targetAgent, file, line, text, status, reply,
                created_at as createdAt, seen_at as seenAt, applied_at as appliedAt, via
           from notes where ticket = ? and (? is null or status = ?) order by id`,
      )
      .all(this.ticketName(), status ?? null, status ?? null) as unknown as Record<string, unknown>[];
    return rows.map(
      (row) =>
        Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as unknown as StoredNote,
    );
  }

  markNotesSeen(ids: number[]): void {
    const mark = this.db.prepare("update notes set status = 'seen', seen_at = ? where id = ? and status = 'queued'");
    const at = new Date().toISOString();
    for (const id of ids) mark.run(at, id);
  }

  applyNotes(applied: AppliedNote[]): void {
    const mark = this.db.prepare(
      `update notes set status = 'applied', reply = ?, applied_at = ?, seen_at = coalesce(seen_at, ?)
        where id = ? and ticket = ? and status != 'applied'`,
    );
    const at = new Date().toISOString();
    for (const note of applied) mark.run(note.reply, at, at, note.id, this.ticketName());
  }

  fileWrites(): { agent: string; at: string; file: string }[] {
    return this.eventsOfKind("tool_use").flatMap((event) => {
      try {
        const data = JSON.parse(event.data ?? "{}") as { tool?: unknown; cmd?: unknown };
        const writes = data.tool === "Write" || data.tool === "Edit" || data.tool === "MultiEdit";
        return writes && typeof data.cmd === "string" && data.cmd.length > 0
          ? [{ agent: event.agent, at: event.at, file: data.cmd }]
          : [];
      } catch {
        return [];
      }
    });
  }

  private hasColumn(table: string, column: string): boolean {
    return (
      this.db
        .prepare(`select 1 from pragma_table_info('${table}') where name = ?`)
        .get(column) !== undefined
    );
  }

  private hasTable(table: string): boolean {
    return (
      this.db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table) !==
      undefined
    );
  }

  earlyAnswer(ticket: string, qid: number): string | undefined {
    if (!this.hasTable("early_answers")) return undefined;
    const row = this.db
      .prepare("select answer from early_answers where ticket = ? and qid = ?")
      .get(ticket, qid) as { answer: string } | undefined;
    return row?.answer;
  }

  saveEarlyAnswer(ticket: string, qid: number, answer: string): boolean {
    const result = this.db
      .prepare(
        `insert into early_answers (ticket, qid, answer, at) values (?, ?, ?, ?)
         on conflict (ticket, qid) do nothing`,
      )
      .run(ticket, qid, answer, new Date().toISOString());
    return Number(result.changes) > 0;
  }

  earlyAnswers(ticket: string): StoredEarlyAnswer[] {
    if (!this.hasTable("early_answers")) return [];
    return this.db
      .prepare("select qid, answer, at from early_answers where ticket = ? order by qid")
      .all(ticket) as unknown as StoredEarlyAnswer[];
  }

  grillItems(): StoredGrillItem[] {
    const via = this.hasColumn("questions", "answered_via") ? "answered_via" : "null";
    const rows = this.db
      .prepare(
        `select id, question, answer, answered_at as answeredAt, ${via} as answeredVia,
                answered_by as answeredBy, payload_json as payloadJson
           from questions
          where payload_json like '%"grill":true%'
          order by at`,
      )
      .all() as unknown as (Omit<StoredGrillItem, "payload"> & { payloadJson: string })[];
    return rows.map(({ payloadJson, ...row }) => ({ ...row, payload: parsePayload(payloadJson) }));
  }

  streamEventsAfter(afterSeq: number, limit: number): StoredStreamEvent[] {
    return this.db
      .prepare(
        `select rowid as seq, at, agent, phase, kind, summary, data
           from events where rowid > ? order by rowid limit ?`,
      )
      .all(afterSeq, limit) as unknown as StoredStreamEvent[];
  }

  toolTicks(limit: number): { agent: string; at: string }[] {
    return this.db
      .prepare(`select agent, at from events where kind = 'tool_use' order by rowid limit ?`)
      .all(limit) as unknown as { agent: string; at: string }[];
  }

  streamEventsUntil(until: string, limit: number): StoredStreamEvent[] {
    const rows = this.db
      .prepare(
        `select rowid as seq, at, agent, phase, kind, summary, data
           from events where at <= ? order by rowid desc limit ?`,
      )
      .all(until, limit) as unknown as StoredStreamEvent[];
    return rows.reverse();
  }

  eventsOfKind(kind: string): StoredStreamEvent[] {
    return this.db
      .prepare(
        `select rowid as seq, at, agent, phase, kind, summary, data
           from events where kind = ? order by rowid`,
      )
      .all(kind) as unknown as StoredStreamEvent[];
  }

  stepRows(): StoredStepRow[] {
    return this.db
      .prepare(
        `select step as key, base_key as baseKey, attempt, stage, status,
                reason, started_at as startedAt, ended_at as endedAt
           from steps where ticket = ? order by seq`,
      )
      .all(this.ticketName()) as unknown as StoredStepRow[];
  }

  eventsOfAgent(agent: string, kinds: string[], limit: number): StoredStreamEvent[] {
    const marks = kinds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `select rowid as seq, at, agent, phase, kind, summary, data
           from events where agent = ? and kind in (${marks})
          order by rowid desc limit ?`,
      )
      .all(agent, ...kinds, limit) as unknown as StoredStreamEvent[];
    return rows.reverse();
  }

  allEventsOfAgent(agent: string): StoredStreamEvent[] {
    return this.db
      .prepare(
        `select rowid as seq, at, agent, phase, kind, summary, data
           from events where agent = ? order by rowid`,
      )
      .all(agent) as unknown as StoredStreamEvent[];
  }

  latestForgeGateLine(): string | undefined {
    const row = this.db
      .prepare(
        `select summary from events
          where kind = 'note' and summary like 'forge: pass %: D1=%'
          order by rowid desc limit 1`,
      )
      .get() as { summary: string } | undefined;
    return row?.summary;
  }

  latestForgeNote(): { at: string; summary: string } | undefined {
    return this.db
      .prepare(
        `select at, summary from events
          where kind = 'note' and summary like 'forge: %'
          order by rowid desc limit 1`,
      )
      .get() as { at: string; summary: string } | undefined;
  }

  recentStreamEvents(limit: number): StoredStreamEvent[] {
    const rows = this.db
      .prepare(
        `select rowid as seq, at, agent, phase, kind, summary, data
           from events order by rowid desc limit ?`,
      )
      .all(limit) as unknown as StoredStreamEvent[];
    return rows.reverse();
  }

  samplesAfter(ticket: string, afterId: number): (Sample & { id: number })[] {
    return this.db
      .prepare(
        `select id, worker_id as workerId, at, tokens, cost_usd as costUsd
           from samples where ticket = ? and id > ? order by id`,
      )
      .all(ticket, afterId) as unknown as (Sample & { id: number })[];
  }

  lastSampleId(ticket: string): number {
    const row = this.db
      .prepare("select max(id) as last from samples where ticket = ?")
      .get(ticket) as { last: number | null };
    return row.last ?? 0;
  }

  hasHumanItem(id: string): boolean {
    return this.db.prepare("select 1 as present from questions where id = ?").get(id) !== undefined;
  }

  openHumanItems(): OpenHumanItem[] {
    const hasPayload = this.db
      .prepare("select 1 as present from pragma_table_info('questions') where name = 'payload_json'")
      .get();
    const rows = this.db
      .prepare(
        `select id, level as kind, question as text, from_agent as fromAgent, at,
                ${hasPayload ? "payload_json" : "null"} as payloadJson
           from questions where answered_at is null order by at`,
      )
      .all() as unknown as {
      id: string;
      kind: string;
      text: string;
      fromAgent: string;
      at: string;
      payloadJson: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      text: row.text,
      from: row.fromAgent,
      at: row.at,
      payload: parsePayload(row.payloadJson),
    }));
  }

  phases(): StoredPhase[] {
    return this.db
      .prepare(
        `select phase, agent, status, summary, cost_usd as costUsd,
                turns, tokens_in as tokensIn, tokens_out as tokensOut,
                tokens_cache_read as tokensCacheRead,
                tokens_cache_write as tokensCacheWrite, model,
                started_at as startedAt, ended_at as endedAt
           from phases
          where run_id = ?
          order by started_at`,
      )
      .all(this.runId) as unknown as StoredPhase[];
  }

  openQuestions(): StoredQuestion[] {
    return this.db
      .prepare(
        `select id, from_agent as fromAgent, phase, level, question, at
           from questions
          where run_id = ? and answered_at is null
          order by at`,
      )
      .all(this.runId) as unknown as StoredQuestion[];
  }

  answeredQuestions(): StoredQuestion[] {
    return this.db
      .prepare(
        `select id, from_agent as fromAgent, phase, level, question, answer,
                answered_by as answeredBy, at
           from questions
          where run_id = ? and answered_at is not null
          order by at`,
      )
      .all(this.runId) as unknown as StoredQuestion[];
  }

  addSites(sites: Site[]): number {
    const insert = this.db.prepare(
      `insert into sites
         (run_id, path, axis, touches_ba, touches_ip, has_flag, is_writer,
          cluster, state, hits, reached_via)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (run_id, path, axis) do update
         set touches_ba = excluded.touches_ba,
             touches_ip = excluded.touches_ip,
             has_flag   = excluded.has_flag,
             is_writer  = excluded.is_writer,
             cluster    = excluded.cluster,
             hits       = excluded.hits,
             reached_via = excluded.reached_via`,
    );
    this.db.exec("begin");
    for (const site of sites) {
      insert.run(
        this.runId,
        site.path,
        site.axis,
        bool(site.touchesBa),
        bool(site.touchesIp),
        bool(site.hasFlag),
        bool(site.isWriter),
        site.cluster ?? null,
        site.state ?? "untriaged",
        site.hits ?? 1,
        site.reachedVia ?? null,
      );
    }
    this.db.exec("commit");
    return sites.length;
  }

  setSiteState(path: string, axis: string, state: SiteState): void {
    this.db
      .prepare(
        "update sites set state = ? where run_id = ? and path = ? and axis = ?",
      )
      .run(state, this.runId, path, axis);
  }

  sitesForCluster(cluster: string): Site[] {
    return this.db
      .prepare(
        `select id, path, axis, touches_ba as touchesBa, touches_ip as touchesIp,
                has_flag as hasFlag, is_writer as isWriter, cluster, state,
                hits, reached_via as reachedVia
           from sites
          where run_id = ? and cluster = ?
          order by is_writer desc, path`,
      )
      .all(this.runId, cluster) as unknown as Site[];
  }

  untriagedSites(): Site[] {
    return this.db
      .prepare(
        `select id, path, axis, touches_ba as touchesBa, touches_ip as touchesIp,
                has_flag as hasFlag, is_writer as isWriter, cluster, state,
                hits, reached_via as reachedVia
           from sites
          where run_id = ? and state = 'untriaged'
          order by is_writer desc, axis, path`,
      )
      .all(this.runId) as unknown as Site[];
  }

  siteCounts(): Record<string, number> {
    const rows = this.db
      .prepare(
        `select axis || ':' || state as key, count(*) as n
           from sites where run_id = ? group by key order by key`,
      )
      .all(this.runId) as unknown as { key: string; n: number }[];
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.key] = row.n;
    return counts;
  }

  upsertFinding(finding: Finding): void {
    this.db
      .prepare(
        `insert into findings
           (id, run_id, site_id, operation, claim, behavior_flag_on,
            behavior_flag_off, target_state, severity, status, evidence,
            found_by, at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update
           set claim             = excluded.claim,
               behavior_flag_on  = excluded.behavior_flag_on,
               behavior_flag_off = excluded.behavior_flag_off,
               target_state      = excluded.target_state,
               severity          = excluded.severity,
               evidence          = excluded.evidence`,
      )
      .run(
        finding.id,
        this.runId,
        finding.siteId ?? null,
        finding.operation,
        finding.claim,
        finding.behaviorFlagOn ?? null,
        finding.behaviorFlagOff ?? null,
        finding.targetState ?? null,
        finding.severity,
        finding.status,
        finding.evidence ?? null,
        finding.foundBy ?? null,
        new Date().toISOString(),
      );
  }

  recordVerdict(
    id: string,
    status: FindingStatus,
    verdict: string,
    verifiedBy: string,
  ): void {
    this.db
      .prepare(
        `update findings set status = ?, verdict = ?, verified_by = ?
          where id = ? and run_id = ?`,
      )
      .run(status, verdict, verifiedBy, id, this.runId);
  }

  findings(status?: FindingStatus): Finding[] {
    const sql = `select id, site_id as siteId, operation, claim,
                        behavior_flag_on as behaviorFlagOn,
                        behavior_flag_off as behaviorFlagOff,
                        target_state as targetState, severity, status, verdict,
                        evidence, found_by as foundBy, verified_by as verifiedBy
                   from findings
                  where run_id = ?${status ? " and status = ?" : ""}
                  order by case severity
                             when 'data_loss' then 0
                             when 'wrong_display' then 1
                             else 2 end, id`;
    const statement = this.db.prepare(sql);
    const rows = status
      ? statement.all(this.runId, status)
      : statement.all(this.runId);
    return rows as unknown as Finding[];
  }

  allQuestions(): (StoredQuestion & { runId: string })[] {
    return this.db
      .prepare(
        `select id, run_id as runId, from_agent as fromAgent, phase, level,
                question, answer, answered_by as answeredBy, at
           from questions
          order by answered_at is not null, at desc`,
      )
      .all() as unknown as (StoredQuestion & { runId: string })[];
  }

  runStatus(): { status: string; endedAt?: string } | undefined {
    const rows = this.db
      .prepare(
        "select status, ended_at as endedAt from runs where run_id = ?",
      )
      .all(this.runId) as unknown as { status: string; endedAt?: string }[];
    return rows[0];
  }

  answerFor(id: string): string | undefined {
    const rows = this.db
      .prepare(
        `select answer from questions
          where id = ? and run_id = ? and answered_at is not null`,
      )
      .all(id, this.runId) as unknown as { answer: string }[];
    return rows[0]?.answer;
  }

  totalSites(): number {
    const row = this.db
      .prepare("select count(*) as n from sites where run_id = ?")
      .get(this.runId) as unknown as { n: number };
    return row.n;
  }

  untriagedInCluster(cluster: string): Site[] {
    return this.db
      .prepare(
        `select id, path, axis, touches_ba as touchesBa, touches_ip as touchesIp,
                has_flag as hasFlag, is_writer as isWriter, cluster, state,
                hits, reached_via as reachedVia
           from sites
          where run_id = ? and cluster = ? and state = 'untriaged'
          order by is_writer desc, path`,
      )
      .all(this.runId, cluster) as unknown as Site[];
  }

  clustersWithWork(): { cluster: string; rows: number; writers: number }[] {
    return this.db
      .prepare(
        `select cluster,
                count(*) as rows,
                sum(is_writer) as writers
           from sites
          where run_id = ? and state = 'untriaged' and cluster is not null
          group by cluster
          order by sum(is_writer) desc, count(*) desc`,
      )
      .all(this.runId) as unknown as {
      cluster: string;
      rows: number;
      writers: number;
    }[];
  }

  findingsAwaitingVerdict(): number {
    const row = this.db
      .prepare(
        "select count(*) as n from findings where run_id = ? and status = 'found'",
      )
      .get(this.runId) as unknown as { n: number };
    return row.n;
  }

  siteByPathAndAxis(sitePath: string, axis: string): Site | undefined {
    const rows = this.db
      .prepare(
        `select id, path, axis, touches_ba as touchesBa, touches_ip as touchesIp,
                has_flag as hasFlag, is_writer as isWriter, cluster, state,
                hits, reached_via as reachedVia
           from sites
          where run_id = ? and path = ? and axis = ?`,
      )
      .all(this.runId, sitePath, axis) as unknown as Site[];
    return rows[0];
  }

  close(): void {
    this.db.close();
  }
}
