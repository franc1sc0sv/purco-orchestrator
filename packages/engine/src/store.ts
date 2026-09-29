import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Finding,
  FindingStatus,
  ScratchpadEvent,
  Site,
  SiteState,
  StoredPhase,
  StoredQuestion,
} from "./types.ts";

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

create index if not exists sites_state_idx on sites (run_id, state);
create index if not exists sites_axis_idx on sites (run_id, axis);
create index if not exists findings_status_idx on findings (run_id, status);
create index if not exists questions_open_idx on questions (run_id, answered_at);
`;

const bool = (value: boolean): number => (value ? 1 : 0);

export class Store {
  private readonly db: DatabaseSync;
  private readonly runId: string;

  constructor(dbPath: string, runId: string) {
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
      runs: { lead_session: "text" },
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

  leadSession(): string | undefined {
    const row = this.db
      .prepare("select lead_session as id from runs where run_id = ?")
      .get(this.runId) as { id: string | null } | undefined;
    return row?.id ?? undefined;
  }

  setLeadSession(sessionId: string): void {
    this.db
      .prepare("update runs set lead_session = ? where run_id = ?")
      .run(sessionId, this.runId);
  }

  startRun(ticket: string): void {
    this.db
      .prepare(
        `insert into runs (run_id, ticket, started_at) values (?, ?, ?)
         on conflict (run_id) do update
           set ticket = excluded.ticket, ended_at = null, status = 'running'`,
      )
      .run(this.runId, ticket, new Date().toISOString());
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
  ): void {
    this.db
      .prepare(
        `insert into questions (id, run_id, at, from_agent, phase, level, question)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.runId,
        new Date().toISOString(),
        fromAgent,
        phase,
        level,
        question,
      );
  }

  answerQuestion(id: string, answer: string, answeredBy: string): void {
    this.db
      .prepare(
        `update questions set answer = ?, answered_at = ?, answered_by = ?
          where id = ? and answered_at is null`,
      )
      .run(answer, new Date().toISOString(), answeredBy, id);
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
