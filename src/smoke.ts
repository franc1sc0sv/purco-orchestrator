import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { MessageBus } from "./bus.ts";
import { EscalationRegistry } from "./escalation.ts";
import { buildHooks, isReadOnlySql } from "./hooks.ts";
import { AgentScratch } from "./agent-scratch.ts";
import {
  handleMessage,
  newTotals,
  type StreamTotals,
} from "./message-handler.ts";
import { Scratchpad } from "./scratchpad.ts";
import { SubagentTracker } from "./tracker.ts";
import {
  buildOrchestratorServer,
  ORCH_TOOL_NAMES,
  SERVER_NAME,
} from "./tools.ts";
import type { EventKind } from "./types.ts";

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-smoke-"));

const scratchpad = new Scratchpad(runDir, "smoke", "PURCO-0000");
const tracker = new SubagentTracker(scratchpad);
const bus = new MessageBus(scratchpad, runDir);

const arbiterCalls: string[] = [];
const humanCalls: string[] = [];

const escalations = new EscalationRegistry(scratchpad, runDir, {
  askOrchestrator: async (question) => {
    arbiterCalls.push(question);
    return "Use the existing feature flag. Do not add a second one.";
  },
  askHuman: async (question) => {
    humanCalls.push(question);
    return "Human says proceed.";
  },
});

tracker.setPhase("plan");
tracker.setMainLabel("PLANNER-1");

const scratch = new AgentScratch(runDir);

const server = buildOrchestratorServer({
  scratchpad,
  bus,
  escalations,
  scratch,
  currentPhase: () => tracker.currentPhase(),
  currentRole: () => "planner",
  activeAgent: () => tracker.active(),
  resolvePath: (candidate) => candidate,
  recordHandoff: () => {},
});

bus.report({
  from: "ORCHESTRATOR",
  subject: "Scope note",
  body: "Widget 6 is period-invariant by design. Do not treat that as a bug.",
  forRole: "planner",
  phase: "plan",
});
bus.relay("planner", "PLANNER-1", "plan");

const task = `You are PLANNER-1. This is a plumbing test of your tools. Perform these steps in order, exactly once each, then stop:

1. Call inbox with from "PLANNER-1" and repeat back what it said.
2. Call note with from "PLANNER-1" and text "smoke test started".
3. Call think with from "PLANNER-1" and text "the flag decision is not mine to make".
4. Call ask with from "PLANNER-1", question "Should I add a new feature flag or reuse the existing one?".
5. Call report with from "PLANNER-1", subject "flag matrix", body "test both flag states", for_role "tester".
6. Call escalate with from "PLANNER-1", level "human", summary "need production credential decision".
7. Call handoff with from "PLANNER-1", summary "smoke complete", output_path "none".

Then reply with the single word DONE. Do not use any other tool.`;

const totals: StreamTotals = newTotals();

for await (const message of query({
  prompt: task,
  options: {
    model: "claude-opus-5",
    cwd: runDir,
    settingSources: [],
    mcpServers: { [SERVER_NAME]: server },
    allowedTools: ORCH_TOOL_NAMES,
    permissionMode: "bypassPermissions",
    hooks: buildHooks({
      scratchpad,
      tracker,
      escalations,
      recordFileWritten: () => {},
    }),
    forwardSubagentText: true,
    maxTurns: 24,
    effort: "low",
  },
})) {
  handleMessage(message, { scratchpad, tracker }, totals);
}

await scratchpad.close();

const events = fs
  .readFileSync(path.join(runDir, "events.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map(
    (line) =>
      JSON.parse(line) as { kind: EventKind; agent: string; summary: string },
  );

const kinds = new Set(events.map((event) => event.kind));
const escalationRecords = JSON.parse(
  fs.readFileSync(path.join(runDir, "escalations.json"), "utf8"),
) as Array<{ level: string; resolvedBy?: string; resolution?: string }>;
const messages = JSON.parse(
  fs.readFileSync(path.join(runDir, "messages.json"), "utf8"),
) as Array<{
  from: string;
  to: string;
  forRole?: string;
  relayedTo?: string;
  readAt?: string;
}>;

const sqlAllowed = [
  "SELECT 1",
  "select * from claims where id = 1",
  "EXPLAIN SELECT id FROM claims",
  "with recent as (select id from claims) select * from recent",
  "  -- a comment\n select count(*) from claims",
];

const sqlBlocked = [
  "DELETE FROM claims",
  "delete from claims",
  "UPDATE claims SET settled = true",
  "INSERT INTO claims (id) VALUES (1)",
  "DROP TABLE claims",
  "TRUNCATE claims",
  "ALTER TABLE claims ADD COLUMN x int",
  "select 1; delete from claims",
  "WITH x AS (DELETE FROM claims RETURNING id) SELECT * FROM x",
  "REFRESH MATERIALIZED VIEW bucket_report",
  "GRANT ALL ON claims TO public",
  "",
  "VACUUM claims",
];

const checks: Array<[string, boolean]> = [
  ["result subtype success", totals.subtype === "success"],
  [
    "sql guard allows read statements",
    sqlAllowed.every((sql) => isReadOnlySql(sql)),
  ],
  [
    "sql guard blocks every write statement",
    sqlBlocked.every((sql) => !isReadOnlySql(sql)),
  ],
  ["note recorded", kinds.has("note")],
  ["thinking recorded", kinds.has("thinking")],
  ["question recorded", kinds.has("question")],
  ["answer recorded", kinds.has("answer")],
  ["escalation recorded", kinds.has("escalation")],
  ["resolution recorded", kinds.has("resolution")],
  ["message recorded", kinds.has("message")],
  ["handoff recorded", kinds.has("handoff")],
  ["tool_use observed by hook", kinds.has("tool_use")],
  ["arbiter was asked", arbiterCalls.length >= 1],
  ["human was asked", humanCalls.length >= 1],
  [
    "orchestrator answer reached the agent",
    events.some(
      (event) =>
        event.kind === "answer" &&
        event.summary.includes("existing feature flag"),
    ),
  ],
  [
    "handed message was read",
    messages.some(
      (m) => m.relayedTo === "PLANNER-1" && m.readAt !== undefined,
    ),
  ],
  [
    "message queued for a later role",
    messages.some((m) => m.from === "PLANNER-1" && m.forRole === "tester"),
  ],
  [
    "every message is addressed to the coordinator",
    messages.every((m) => m.to === "ORCHESTRATOR"),
  ],
  [
    "human escalation resolved by human",
    escalationRecords.some(
      (e) => e.level === "human" && e.resolvedBy === "human",
    ),
  ],
  [
    "events attributed to PLANNER-1",
    events.some((event) => event.agent === "PLANNER-1"),
  ],
  ["live.md written", fs.existsSync(path.join(runDir, "live.md"))],
];

let failed = 0;
for (const [name, ok] of checks) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}\n`);
  if (!ok) failed++;
}

process.stdout.write(
  `\n${checks.length - failed}/${checks.length} checks passed · ${events.length} events · $${totals.costUsd.toFixed(4)} · ${totals.turns} turns\n`,
);
process.stdout.write(`run dir ${runDir}\n`);
if (totals.errors.length > 0) {
  process.stdout.write(`errors: ${totals.errors.join("; ")}\n`);
}
process.exit(failed === 0 ? 0 : 1);
