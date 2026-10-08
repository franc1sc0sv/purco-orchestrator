import type { Store, StoredStepRow, StoredStreamEvent } from "./store.ts";
import type { WorkerRow } from "./telemetry.ts";
import type { Stage, StepStatus } from "./types.ts";

const MOVE_COUNT = 6;
const MOVE_KINDS = ["tool_use", "text", "tool_error", "permission_denied"];
const FIRST_LINE_LIMIT = 120;
const SAID_LIMIT = 200;
const DETAIL_LIMIT = 28;

type FailureKind = { id: string; label: string };

const KIND_RULES: (FailureKind & { test: RegExp })[] = [
  { id: "burn-rate", label: "Burn rate stop", test: /burn rate/ },
  { id: "stuck", label: "Stuck, no progress", test: /\bstuck\b/ },
  { id: "stopped", label: "You stopped it", test: /human stopped|stopped by|you stopped|was stopped/ },
  { id: "no-result", label: "No result from the worker", test: /^no result/ },
  { id: "static", label: "Static check red", test: /\btsc\b|typecheck|lint|biome|static/ },
  { id: "test-env", label: "Test env down", test: /econnrefused|container|docker|database|test env/ },
];

const OTHER_KIND: FailureKind = { id: "other", label: "Other failure" };

export const classifyFailure = (reason: string | null, haltReason: string | undefined): FailureKind => {
  const text = `${haltReason ?? ""} ${reason ?? ""}`.trim().toLowerCase();
  const rule = KIND_RULES.find((candidate) => candidate.test.test(text));
  return rule ? { id: rule.id, label: rule.label } : OTHER_KIND;
};

export type MapStep = {
  key: string;
  baseKey: string;
  stage: Stage;
  status: StepStatus;
  tries: number;
};

export type LastMove = { label: string; detail: string; bad: boolean };

export type FailureGroup = {
  key: string;
  kind: FailureKind;
  stepKind: string;
  title: string;
  steps: string[];
  tries: number;
  expected: string | null;
  got: string | null;
  said: string | null;
  fixedIn: string | null;
  worker: string | null;
  lastMoves: LastMove[];
};

export type KindCount = FailureKind & { count: number };

export type FailuresView = {
  map: MapStep[];
  groups: FailureGroup[];
  resume: { step: string; command: string } | null;
  costUsd: number;
  failedSteps: number;
  kinds: KindCount[];
};

const isFailedStatus = (status: StepStatus): boolean => status === "failed" || status === "halted";

const firstLine = (text: string): string => (text.split("\n")[0] ?? "").trim().slice(0, FIRST_LINE_LIMIT);

const stepKindOf = (baseKey: string): string => baseKey.split(":").slice(0, 2).join(":");

const parseData = (json: string | null): Record<string, unknown> => {
  if (json === null) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const shorten = (text: string): string =>
  text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT - 1)}…` : text;

const targetOf = (summary: string): string => {
  const rest = summary.split(" ").slice(1).join(" ").replace(/^\w+=/, "");
  const tail = rest.includes("/") ? rest.split("/").slice(-2).join("/") : rest;
  return shorten(tail.trim());
};

const toolName = (tool: string): string => (tool.startsWith("mcp__") ? (tool.split("__").pop() ?? tool) : tool);

const moveOf = (event: StoredStreamEvent): LastMove => {
  if (event.kind === "tool_use") {
    const data = parseData(event.data);
    const tool = typeof data.tool === "string" ? data.tool : (event.summary.split(" ")[0] ?? "");
    const cmd = typeof data.cmd === "string" ? shorten(data.cmd.replace(/\s+/g, " ").trim()) : targetOf(event.summary);
    return { label: toolName(tool), detail: cmd, bad: false };
  }
  if (event.kind === "text") return { label: "Said", detail: shorten(event.summary), bad: false };
  if (event.kind === "permission_denied") {
    return { label: "Blocked", detail: shorten(event.summary.replace(/^blocked\s*/, "")), bad: true };
  }
  return { label: "Error", detail: shorten(event.summary), bad: true };
};

const workerOfStep = (workers: WorkerRow[], stepKey: string): WorkerRow | undefined =>
  workers.filter((worker) => worker.step === stepKey).pop();

const runWorkflow = (store: Store): string | undefined => {
  for (const row of store.eventsOfKind("note")) {
    const config = parseData(row.data).config;
    if (typeof config === "object" && config !== null && "workflow" in config) {
      return typeof config.workflow === "string" ? config.workflow : undefined;
    }
  }
  return undefined;
};

const resumeCommand = (ticket: string, workflow: string | undefined): string =>
  `purco-orchestrate ${ticket} --resume${workflow && workflow !== "ticket" ? ` --workflow ${workflow}` : ""}`;

const groupOf = (store: Store, rows: StoredStepRow[], workers: WorkerRow[]) => {
  const failed = rows.filter((row) => isFailedStatus(row.status));
  const groups = new Map<string, { kind: FailureKind; stepKind: string; title: string; rows: StoredStepRow[] }>();
  for (const row of failed) {
    const worker = workerOfStep(workers, row.key);
    const kind = classifyFailure(row.reason, worker?.haltReason);
    const title = firstLine(worker?.haltReason || row.reason || "no reason recorded");
    const stepKind = stepKindOf(row.baseKey);
    const key = `${kind.id}|${stepKind}|${title}`;
    const group = groups.get(key) ?? { kind, stepKind, title, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]): FailureGroup => {
    const latest = group.rows[group.rows.length - 1] as StoredStepRow;
    const worker = workerOfStep(workers, latest.key);
    const moves = worker ? store.eventsOfAgent(worker.label, MOVE_KINDS, MOVE_COUNT) : [];
    const said = worker ? store.eventsOfAgent(worker.label, ["text"], 1)[0] : undefined;
    const fix = rows.find(
      (row) => row.baseKey === latest.baseKey && row.attempt > latest.attempt && row.status === "done",
    );
    return {
      key,
      kind: group.kind,
      stepKind: group.stepKind,
      title: group.title,
      steps: [...new Set(group.rows.map((row) => row.baseKey))],
      tries: group.rows.length,
      expected: group.kind.id === "no-result" ? "A handoff from the worker" : null,
      got: group.title,
      said: said ? said.summary.slice(0, SAID_LIMIT) : null,
      fixedIn: fix ? `Attempt ${fix.attempt}` : null,
      worker: worker?.label ?? null,
      lastMoves: moves.map(moveOf),
    };
  });
};

const mapOf = (store: Store, rows: StoredStepRow[]): MapStep[] =>
  store.pipeline().flatMap((stage) =>
    stage.steps.map((step) => ({
      key: step.key,
      baseKey: step.baseKey,
      stage: stage.stage,
      status: step.status,
      tries: rows.filter((row) => row.baseKey === step.baseKey && isFailedStatus(row.status)).length,
    })),
  );

export const buildFailuresView = (ticket: string, store: Store, kinds: KindCount[]): FailuresView => {
  const rows = store.stepRows();
  const workers = store.workers(ticket);
  const map = mapOf(store, rows);
  const failedKeys = new Set(rows.filter((row) => isFailedStatus(row.status)).map((row) => row.key));
  const firstFailed = map.find((step) => isFailedStatus(step.status));
  return {
    map,
    groups: groupOf(store, rows, workers),
    resume: firstFailed ? { step: firstFailed.baseKey, command: resumeCommand(ticket, runWorkflow(store)) } : null,
    costUsd: workers.filter((worker) => failedKeys.has(worker.step)).reduce((sum, worker) => sum + worker.costUsd, 0),
    failedSteps: map.filter((step) => isFailedStatus(step.status)).length,
    kinds,
  };
};

export const countFailureKinds = (store: Store, ticket: string, sinceMs: number, into: Map<string, KindCount>): void => {
  const workers = store.workers(ticket);
  for (const row of store.stepRows()) {
    if (!isFailedStatus(row.status)) continue;
    const at = Date.parse(row.endedAt ?? row.startedAt ?? "");
    if (Number.isNaN(at) || at < sinceMs) continue;
    const kind = classifyFailure(row.reason, workerOfStep(workers, row.key)?.haltReason);
    const known = into.get(kind.id);
    into.set(kind.id, { ...kind, count: (known?.count ?? 0) + 1 });
  }
};

export const rawLogOf = (store: Store, agent: string): string =>
  store
    .allEventsOfAgent(agent)
    .map((event) => `${event.at} ${event.kind} ${event.summary}`)
    .join("\n");
