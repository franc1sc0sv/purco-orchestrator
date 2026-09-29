import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentScratch } from "./agent-scratch.ts";
import { phaseGate } from "./gates.ts";
import { Journal } from "./journal.ts";
import { parseArbiterVerdict } from "./orchestrator.ts";
import { ROLE_SPECS, buildAgentDefinitions } from "./roles.ts";
import { Store } from "./store.ts";
import { MODELS, PHASE_ROLE, ROLES, type RoleName } from "./types.ts";

let passed = 0;
let failed = 0;

const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) {
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
    return;
  }
  failed += 1;
  process.stdout.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
};

const section = (title: string): void => {
  process.stdout.write(`\n${title}\n`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-engine-"));
process.stdout.write(`engine — ${tmp}\n`);

section("the arbiter verdict contract");

const jsonVerdict = parseArbiterVerdict(
  '{"decision":"defer","text":"Which tenant ships first?","confidence":"high"}',
);
check("a JSON verdict parses", jsonVerdict.decision === "defer");
check("its text survives", jsonVerdict.text === "Which tenant ships first?");
check("its confidence survives", jsonVerdict.confidence === "high");

const prosed = parseArbiterVerdict(
  'Here is my call:\n{"decision":"answer","text":"Use the existing flag."}',
);
check("JSON wrapped in prose still parses", prosed.decision === "answer");
check("the wrapped text survives", prosed.text === "Use the existing flag.");

const legacy = parseArbiterVerdict("DEFER TO HUMAN Which base branch?");
check("the old prefix still defers", legacy.decision === "defer");
check("the old prefix drops its marker", legacy.text === "Which base branch?");

const garbage = parseArbiterVerdict("I think you should use Kysely here.");
check("free text is treated as an answer", garbage.decision === "answer");
check("free text is marked low confidence", garbage.confidence === "low");

const emptyJson = parseArbiterVerdict('{"decision":"answer","text":""}');
check(
  "JSON with no text falls back to the raw reply",
  emptyJson.text.includes("decision"),
);

section("the plan gate");

const packA = path.join(tmp, "pack-a");
fs.mkdirSync(packA, { recursive: true });
const gateDb = new Store(path.join(tmp, "gate.sqlite"), "run-gate");

check(
  "plan is refused with no decisions file",
  !phaseGate("plan", gateDb, packA).ok,
);
check(
  "the refusal names the missing file",
  phaseGate("plan", gateDb, packA).reason.includes("03-decisions.md"),
);

fs.writeFileSync(
  path.join(packA, "03-decisions.md"),
  "# Decisions\n\n- Use the existing flag.\n- [ ] Which tenant ships first?\n- [ ] Who owns the backfill?\n",
);
const open = phaseGate("plan", gateDb, packA);
check("plan is refused while a checkbox is open", !open.ok);
check("the refusal counts the open ones", open.reason.includes("2 decisions"));
check(
  "the refusal quotes the first question",
  open.reason.includes("Which tenant ships first?"),
);

fs.writeFileSync(
  path.join(packA, "03-decisions.md"),
  "# Decisions\n\n- Use the existing flag.\n- PurCo ships first.\n",
);
check("plan opens once nothing is open", phaseGate("plan", gateDb, packA).ok);

section("the store: tokens and resume");

const store = new Store(path.join(tmp, "run.sqlite"), "run-1");
store.startRun("PURCO-9999");
store.startPhase("intake", "INTAKE-1");
store.endPhase({
  phase: "intake",
  status: "done",
  summary: "read the ticket",
  costUsd: 0.12,
  turns: 6,
  tokensIn: 1000,
  tokensOut: 200,
  tokensCacheRead: 30000,
  tokensCacheWrite: 400,
  model: MODELS.sonnet,
});
store.startPhase("grill", "INQUISITOR-1");
store.endPhase({
  phase: "grill",
  status: "escalated",
  summary: "blocked",
  costUsd: 0.03,
  turns: 2,
  tokensIn: 10,
  tokensOut: 5,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
});

const completed = store.completedPhases();
check("a finished phase is listed as complete", completed.includes("intake"));
check(
  "an escalated phase is not listed as complete",
  !completed.includes("grill"),
);

const spent = store
  .phases()
  .reduce((sum, phase) => sum + (phase.costUsd ?? 0), 0);
check(
  "the store totals the cost of the whole run",
  Math.abs(spent - 0.15) < 0.0001,
  String(spent),
);

const row = store.phases().find((phase) => phase.phase === "intake");
check("the phase row keeps its input tokens", row?.tokensIn === 1000);
check("the phase row keeps its cache reads", row?.tokensCacheRead === 30000);
check("the phase row keeps its model", row?.model === MODELS.sonnet);

section("the per-role scratchpad");

const scratchDir = path.join(tmp, "run-dir");
const scratch = new AgentScratch(scratchDir);
scratch.write("builder", "slice-1", "wrote the usecase, tests still missing");
scratch.write("builder", "slice-2", "not started");
check("the scratchpad keeps both entries", scratch.read("builder").length === 2);

scratch.write("builder", "slice-1", "usecase and tests done");
const entries = scratch.read("builder");
check("writing the same key replaces it", entries.length === 2);
check(
  "the replacement wins",
  entries.find((e) => e.key === "slice-1")?.value === "usecase and tests done",
);
check("another role sees nothing", scratch.read("tester").length === 0);

section("the phase journal");

const journal = new Journal(scratchDir, "run-1", tmp);
journal.start("build", "Implement brief one");
check(
  "a first attempt needs no resume note",
  journal.resumeNote("build") === "",
);

journal.recordFile("build", "src/server/api/thing.ts");
journal.recordFile("build", "src/server/api/thing.ts");
check(
  "a file is recorded once",
  journal.read("build")?.filesWritten.length === 1,
);

journal.end("build", "interrupted");
journal.start("build", "Implement brief one");
const note = journal.resumeNote("build");
check("a second attempt gets a resume note", note.length > 0);
check("the note says it is attempt 2", note.includes("attempt 2"));
check(
  "the note names what the last attempt wrote",
  note.includes("src/server/api/thing.ts"),
);
check(
  "the note carries the earlier files forward",
  journal.read("build")?.filesWritten.length === 1,
);

section("models and roles");

check(
  "every role declares a model",
  ROLES.every((role) => ROLE_SPECS[role].model.length > 0),
);
check("static no longer runs as the builder", PHASE_ROLE.static === "fixer");
check(
  "the fixer is the cheapest model",
  ROLE_SPECS.fixer.model === MODELS.haiku,
);
check("the fixer has a small turn budget", ROLE_SPECS.fixer.maxTurns <= 30);
check("the planner stays on opus", ROLE_SPECS.planner.model === MODELS.opus);
check("intake drops to sonnet", ROLE_SPECS.intake.model === MODELS.sonnet);

const vars = {
  AGENT: "BUILDER-1",
  TICKET: "PURCO-9999",
  WORKTREE: tmp,
  PACK: packA,
  BASE: "dev",
  BRIEF: "",
};
const only = buildAgentDefinitions(vars, ["builder"]);
check("a phase builds one definition", Object.keys(only).length === 1);
check("it is the running role", Object.keys(only)[0] === "builder");
check(
  "it carries the role's own model",
  only.builder?.model === ROLE_SPECS.builder.model,
);

const overridden = buildAgentDefinitions(vars, ["builder"], MODELS.haiku);
check(
  "an override beats the role's model",
  overridden.builder?.model === MODELS.haiku,
);

const everyRole = buildAgentDefinitions(vars, [...ROLES] as RoleName[]);
check(
  "asking for every role still works",
  Object.keys(everyRole).length === ROLES.length,
);

store.close();
gateDb.close();
fs.rmSync(tmp, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
