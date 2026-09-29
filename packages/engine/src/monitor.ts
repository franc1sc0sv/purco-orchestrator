import fs from "node:fs";
import { Store } from "./store.ts";
import http from "node:http";
import path from "node:path";
import { MONITOR_PAGE } from "./monitor-page.ts";

const GAF = path.join(
  process.env.HOME ?? "",
  "projects/purco-projects/general-access-files",
);

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

type RawEvent = {
  seq: number;
  at: string;
  runId: string;
  ticket: string;
  agent: string;
  phase: string;
  kind: string;
  summary: string;
  data?: Record<string, unknown>;
};

type AgentView = {
  label: string;
  events: number;
  toolCalls: number;
  failures: number;
  thoughts: number;
  questions: number;
  escalations: number;
  messagesSent: number;
  firstSeen: string;
  lastSeen: string;
  lastAction: string;
};

type RunView = {
  ticket: string;
  runId: string;
  runDir: string;
  startedAt: string;
  lastEventAt: string;
  active: boolean;
  ended: boolean;
  phases: Array<{ phase: string; status: string; agent: string; cost: number }>;
  agents: AgentView[];
  subagentCount: number;
  costUsd: number;
  eventCount: number;
  decisions: Array<{
    id: string;
    level: string;
    from: string;
    phase: string;
    summary: string;
    resolution?: string;
    resolvedBy?: string;
    attempts: number;
  }>;
  messages: Array<{
    id: string;
    from: string;
    to: string;
    subject: string;
    body: string;
    at: string;
    readAt?: string;
  }>;
  recent: RawEvent[];
};

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
};

const readEvents = (file: string): RawEvent[] => {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.length > 1)
      .map((line) => {
        try {
          return JSON.parse(line) as RawEvent;
        } catch {
          return undefined;
        }
      })
      .filter((event): event is RawEvent => event !== undefined);
  } catch {
    return [];
  }
};

const buildRun = (ticket: string, runDir: string): RunView | undefined => {
  const eventsFile = path.join(runDir, "events.jsonl");
  if (!fs.existsSync(eventsFile)) return undefined;
  const events = readEvents(eventsFile);
  if (events.length === 0) return undefined;

  const runId = path.basename(runDir);
  const startedAt = events[0].at;
  const lastEventAt = events[events.length - 1].at;
  const ended = events.some((event) => event.kind === "run_end");
  const active =
    !ended && Date.now() - new Date(lastEventAt).getTime() < ACTIVE_WINDOW_MS;

  const agents = new Map<string, AgentView>();
  const phases = new Map<
    string,
    { phase: string; status: string; agent: string; cost: number }
  >();
  let costUsd = 0;

  for (const event of events) {
    const view =
      agents.get(event.agent) ??
      ({
        label: event.agent,
        events: 0,
        toolCalls: 0,
        failures: 0,
        thoughts: 0,
        questions: 0,
        escalations: 0,
        messagesSent: 0,
        firstSeen: event.at,
        lastSeen: event.at,
        lastAction: event.summary,
      } satisfies AgentView);
    view.events += 1;
    view.lastSeen = event.at;
    if (event.kind !== "cost") view.lastAction = event.summary;
    if (event.kind === "tool_use") view.toolCalls += 1;
    if (event.kind === "tool_error") view.failures += 1;
    if (event.kind === "thinking") view.thoughts += 1;
    if (event.kind === "question") view.questions += 1;
    if (event.kind === "escalation") view.escalations += 1;
    if (event.kind === "message" && event.summary.startsWith("->")) {
      view.messagesSent += 1;
    }
    agents.set(event.agent, view);

    if (event.kind === "phase_start") {
      phases.set(event.phase, {
        phase: event.phase,
        status: "running",
        agent: event.agent,
        cost: 0,
      });
    }
    if (event.kind === "phase_end") {
      const outcome = event.data?.outcome as
        { status?: string; agent?: string; costUsd?: number } | undefined;
      phases.set(event.phase, {
        phase: event.phase,
        status: outcome?.status ?? "ended",
        agent: outcome?.agent ?? event.agent,
        cost: outcome?.costUsd ?? 0,
      });
    }
    if (event.kind === "cost") {
      const match = event.summary.match(/\$([0-9.]+)/);
      if (match) costUsd += Number(match[1]);
    }
  }

  const decisions = readJson<
    Array<{
      id: string;
      level: string;
      from: string;
      phase: string;
      summary: string;
      resolution?: string;
      resolvedBy?: string;
      attempts: number;
    }>
  >(path.join(runDir, "escalations.json"), []);

  const messages = readJson<RunView["messages"]>(
    path.join(runDir, "messages.json"),
    [],
  );

  const agentList = [...agents.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  return {
    ticket,
    runId,
    runDir,
    startedAt,
    lastEventAt,
    active,
    ended,
    phases: [...phases.values()],
    agents: agentList,
    subagentCount: agentList.filter((a) => a.label !== "ORCHESTRATOR").length,
    costUsd,
    eventCount: events.length,
    decisions,
    messages,
    recent: events.slice(-120).reverse(),
  };
};

type MailboxView = {
  id: string;
  runId: string;
  fromAgent: string;
  phase: string;
  question: string;
  answer?: string;
  answeredBy?: string;
  at: string;
};

const readMailbox = (ticket: string): MailboxView[] => {
  const dbPath = path.join(GAF, ticket, "orchestrator.sqlite");
  if (!fs.existsSync(dbPath)) return [];
  try {
    const store = new Store(dbPath, "");
    const rows = store.allQuestions();
    store.close();
    return rows as MailboxView[];
  } catch {
    return [];
  }
};

export const collectMailbox = (): MailboxView[] => {
  if (!fs.existsSync(GAF)) return [];
  const all: MailboxView[] = [];
  for (const ticket of fs.readdirSync(GAF)) {
    all.push(...readMailbox(ticket));
  }
  return all;
};

export const collectRuns = (): RunView[] => {
  const runs: RunView[] = [];
  if (!fs.existsSync(GAF)) return runs;
  for (const ticket of fs.readdirSync(GAF)) {
    const runsDir = path.join(GAF, ticket, "orchestrator-runs");
    if (!fs.existsSync(runsDir)) continue;
    for (const runId of fs.readdirSync(runsDir)) {
      const run = buildRun(ticket, path.join(runsDir, runId));
      if (run) runs.push(run);
    }
  }
  return runs.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
};

export const startMonitor = (port: number): void => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/api/state") {
      const runs = collectRuns();
      const mailbox = collectMailbox();
      const body = JSON.stringify({
        generatedAt: new Date().toISOString(),
        mailbox,
        openQuestions: mailbox.filter((q) => q.answer === null || q.answer === undefined)
          .length,
        activeOrchestrators: runs.filter((run) => run.active).length,
        totalRuns: runs.length,
        liveSubagents: runs
          .filter((run) => run.active)
          .reduce((sum, run) => sum + run.subagentCount, 0),
        totalCostUsd: runs.reduce((sum, run) => sum + run.costUsd, 0),
        openDecisions: runs.reduce(
          (sum, run) =>
            sum +
            run.decisions.filter((d) => d.resolvedBy === undefined).length,
          0,
        ),
        runs,
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(body);
      return;
    }

    if (url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(MONITOR_PAGE);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`monitor http://127.0.0.1:${port}\n`);
    process.stdout.write(`watching ${GAF}/*/orchestrator-runs\n`);
  });
};
