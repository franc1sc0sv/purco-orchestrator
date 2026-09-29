import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentScratch } from "./agent-scratch.ts";
import { phaseGate } from "./gates.ts";
import { Journal } from "./journal.ts";
import {
  allocateUsage,
  cycleCost,
  modelKey,
} from "test-forge-runner/src/domain/usage.ts";
import { runGrill } from "./grill.ts";
import { validateDecision } from "./lead.ts";
import { briefSteps, planSteps, stepKey, stepLabel } from "./plan.ts";
import { touchesProtectedFile } from "./protected-files.ts";
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

section("the lead decision contract");

const answer = validateDecision(
  { decision: "answer", text: "Use the existing flag." },
  ["answer"],
);
check("a valid answer passes", answer?.decision === "answer");
check("its text survives", answer?.text === "Use the existing flag.");
check(
  "defer is always allowed",
  validateDecision({ decision: "defer", text: "Which tenant?" }, ["answer"])
    ?.decision === "defer",
);
check(
  "a decision outside the allowed list is refused",
  validateDecision({ decision: "rerun", text: "again" }, ["answer"]) ===
    undefined,
);
check(
  "an empty text is refused",
  validateDecision({ decision: "answer", text: "  " }, ["answer"]) === undefined,
);
check(
  "a non-object is refused",
  validateDecision("answer", ["answer"]) === undefined,
);
const rerun = validateDecision(
  {
    decision: "rerun",
    text: "fix the null check",
    target: "04-brief-a.md",
    settled: [2, "x", 3],
  },
  ["continue", "rerun", "stop"],
);
check("a rerun keeps its target", rerun?.target === "04-brief-a.md");
check("settled keeps only integers", rerun?.settled?.join(",") === "2,3");

section("step keys");

const planned = planSteps(["intake", "grill", "plan", "build"]);
check(
  "grill expands to the worker step and the human step",
  planned.map(stepKey).join(" ") === "intake grill grill:human plan build",
);
const briefs = briefSteps(["/pack/04-brief-a.md", "/pack/04-brief-b.md"]);
check(
  "one build step per brief",
  briefs.map(stepKey).join(" ") === "build:a build:b",
);
check(
  "a second attempt carries its number",
  stepKey({ phase: "build", brief: "/pack/04-brief-a.md", attempt: 2 }) ===
    "build:a#2",
);
check(
  "a brief step is labelled by its brief",
  stepLabel("builder", { phase: "build", brief: "/pack/04-brief-a.md" }) ===
    "BUILDER-a",
);

section("the protected file guard");

const dotenv = [".", "env"].join("");
check(
  "a dotenv read is blocked",
  touchesProtectedFile({ file_path: `/repo/${dotenv}` }),
);
check(
  "a local dotenv is blocked",
  touchesProtectedFile({ command: `cat ${dotenv}.local` }),
);
check(
  "the example file is allowed",
  !touchesProtectedFile({ file_path: `/repo/${dotenv}.example` }),
);
check(
  "process.env in a search is allowed",
  !touchesProtectedFile({ pattern: "process.env.DATABASE_URL" }),
);
check(
  "a normal source file is allowed",
  !touchesProtectedFile({ file_path: "src/server/env.ts" }),
);

section("the grill loop");

const grillPack = path.join(tmp, "grill-pack");
fs.mkdirSync(grillPack, { recursive: true });
fs.writeFileSync(
  path.join(grillPack, "02a-open-questions.json"),
  JSON.stringify({
    questions: [
      {
        id: 1,
        question: "Which flag?",
        options: [{ label: "new" }, { label: "existing" }],
        recommended: "new",
        blocking: true,
      },
      {
        id: 2,
        question: "Log the change?",
        options: ["yes", "no"],
        recommended: "yes",
        blocking: false,
      },
      {
        id: 3,
        question: "Name of the new flag?",
        options: [{ label: "A" }],
        blocking: true,
      },
      {
        id: 4,
        question: "Who owns the backfill?",
        options: [{ label: "ops" }],
        blocking: true,
      },
    ],
  }),
);
const asked: string[] = [];
const grilled = await runGrill({
  pack: grillPack,
  ask: async (text) => {
    asked.push(text);
    return asked.length === 1 ? "existing" : "park";
  },
  prune: async (_answered, _answer, remaining) => ({
    settled: remaining.filter((q) => q.id === 3).map((q) => q.id),
    reason: "an existing flag needs no new name",
  }),
});
const decisions = fs.readFileSync(
  path.join(grillPack, "03-decisions.md"),
  "utf8",
);
check(
  "only unsettled blocking questions are asked",
  asked.length === 2,
  String(asked.length),
);
check(
  "the first question shows its options",
  asked[0]?.includes("a) new") ?? false,
);
check("the answer is recorded", decisions.includes("Q1 Which flag? — existing"));
check(
  "a non-blocking question is assumed",
  decisions.includes("Q2 Log the change? — assumed: yes"),
);
check(
  "the lead settles a moot question",
  decisions.includes("Q3 Name of the new flag? — settled by the answer to Q1"),
);
check(
  "a parked question stays open",
  decisions.includes("- [ ] Q4 Who owns the backfill?"),
);
check(
  "the counts add up",
  grilled?.answered === 1 &&
    grilled.parked === 1 &&
    grilled.assumed === 1 &&
    grilled.settledByLead === 1,
);
const regrilled: string[] = [];
await runGrill({
  pack: grillPack,
  ask: async (text) => {
    regrilled.push(text);
    return "park";
  },
  prune: async () => ({ settled: [], reason: "" }),
});
check("a resumed grill asks nothing already recorded", regrilled.length === 0);

section("the Test Forge cost split");

const post = (callsign: string, model: string, output: number) => ({
  callsign,
  model,
  inputTokens: 0,
  outputTokens: output,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
const split = allocateUsage({
  posts: [
    post("palmer", "claude-opus-5-5-20260801", 100),
    post("carter-a259", "claude-opus-5-5", 300),
    post("locke", "claude-sonnet-5-5", 50),
  ],
  modelCosts: [
    { model: "claude-opus-5-5", costUsd: 4 },
    { model: "claude-sonnet-5-5", costUsd: 1 },
  ],
  recordedByModel: new Map(),
  resumed: false,
});
const costOf = (callsign: string): number =>
  split.find((row) => row.callsign === callsign)?.costUsd ?? -1;
check("a dated model id matches its cost entry", modelKey("claude-opus-5-5-20260801") === "claude-opus-5-5");
check("opus cost splits by token weight", Math.abs(costOf("palmer") - 1) < 1e-9 && Math.abs(costOf("carter-a259") - 3) < 1e-9);
check("sonnet cost goes to its only post", Math.abs(costOf("locke") - 1) < 1e-9);
check(
  "the split adds up to the reported cost",
  Math.abs(split.reduce((sum, row) => sum + row.costUsd, 0) - 5) < 1e-9,
);
check("a resumed cycle pays only the new cost", cycleCost(7, 4, true) === 3);
check("a resumed total below the record pays nothing", cycleCost(3, 4, true) === 0);
check("a fresh cycle pays its full cost", cycleCost(3, 4, false) === 3);
const orphan = allocateUsage({
  posts: [],
  modelCosts: [{ model: "claude-sonnet-5-5", costUsd: 0.2 }],
  recordedByModel: new Map(),
  resumed: false,
});
check("cost with no post is kept under host", orphan[0]?.callsign === "host" && orphan[0].costUsd === 0.2);

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
  "every role runs on Opus 5.5 or Sonnet 5.5",
  ROLES.every((role) =>
    [MODELS.opus, MODELS.sonnet].some((model) => model === ROLE_SPECS[role].model),
  ),
);
check("the fixer runs on sonnet", ROLE_SPECS.fixer.model === MODELS.sonnet);
check("the fixer runs at low effort", ROLE_SPECS.fixer.effort === "low");
check("the fixer has a small turn budget", ROLE_SPECS.fixer.maxTurns <= 30);
check("the planner stays on opus", ROLE_SPECS.planner.model === MODELS.opus);
check("intake drops to sonnet", ROLE_SPECS.intake.model === MODELS.sonnet);

const vars = {
  AGENT: "BUILDER-1",
  WORKFLOW: "ticket",
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

const overridden = buildAgentDefinitions(vars, ["builder"], MODELS.sonnet);
check(
  "an override beats the role's model",
  overridden.builder?.model === MODELS.sonnet,
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
