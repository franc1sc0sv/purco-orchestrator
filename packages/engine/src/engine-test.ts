import { orchestratorToolsProblem } from "./orch-check.ts";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Alerts, notificationScript, notificationSubtitle } from "./alerts.ts";
import { burnTitle, doneTitle, fallbackTitle, gateTitle, haltedTitle, humanTitle, loopTitle, questionTitle, shortName, signTitle, stuckTitle } from "./alert-title.ts";
import { AgentScratch } from "./agent-scratch.ts";
import { WorkerMeter } from "./meter.ts";
import { messageCost } from "./pricing.ts";
import {
  UsageLedger,
  burnRate,
  callSignature,
  contextSize,
  evaluateBurn,
  evaluateStuck,
  isLoop,
  median,
  nextLoopState,
  normalRate,
  rollupCosts,
  type WorkerRow,
} from "./telemetry.ts";
import { Watchdog } from "./watchdog.ts";
import type { CheckOutcome } from "test-forge-contracts/analysis";
import { buildBrief, extractSubjects, settledDecisionLines } from "./brief.ts";
import { parseHandoff } from "./handoff.ts";
import type { PipelineStep } from "./types.ts";
import { deriveTicketState } from "./dashboard-data.ts";
import { acquireLease } from "./lease.ts";
import {
  factsFromCounts,
  parseSizeAnswer,
  raiseSize,
  reviewTaskFor,
  sizeFor,
  sizeForBriefs,
  testDepthFor,
} from "./size.ts";
import { phaseGate } from "./gates.ts";
import {
  findingsFor,
  judgeOutcome,
  planMechanical,
  verdictsFor,
  type MechanicalRule,
} from "./forge-mechanical.ts";
import { Journal } from "./journal.ts";
import { readUnits, routeWork, testSurface } from "./forge-units.ts";
import {
  baselineOf,
  changedTestFiles,
  existingUnits,
  exitDecision,
  mapperFailure,
  protectedTestsOf,
  removedProtectedTests,
  testNames,
} from "./forge-harden.ts";
import { planGatePayload } from "./gate-payload.ts";
import { blocksOf, dedupe, entryFromLine, summarize, type UsageEntry } from "./usage.ts";
import type { PhaseOutcome } from "./types.ts";
import { runGrill } from "./grill.ts";
import { validateDecision } from "./lead.ts";
import { briefSteps, planSteps, stepKey, stepLabel } from "./plan.ts";
import { touchesProtectedFile } from "./protected-files.ts";
import { ROLE_SPECS, buildAgentDefinitions, effortFor } from "./roles.ts";
import { Store } from "./store.ts";
import { testWriteRefusal } from "./test-paths.ts";
import { describeWriteViolation, diffWriteSnapshots, restoreWriteSnapshot, takeWriteSnapshot } from "./write-audit.ts";
import {
  MODELS,
  PHASE_ROLE,
  ROLES,
  STAGE_OF_PHASE,
  stageOfKey,
  type RoleName,
  type StepResult,
} from "./types.ts";
import {
  FLOW_CONFIG,
  FLOW_TIMEOUT_MS,
  LIBRARY_DIR,
  MISSING_PAGES_REASON,
  NO_FLOWS_REASON,
  buildPlaywrightCommand,
  buildRecordResult,
  parseFlowManifest,
  recordFlows,
  recordSkipReason,
  STAGING_DIR,
  videoFileName,
  type Execute,
} from "./record.ts";
import { WORKFLOWS } from "./workflows.ts";
import { checkRequest, injectToken, isAllowedHost, isAllowedOrigin, isJsonContent, isValidToken, type GuardInput } from "./monitor-guard.ts";

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

section("the Test Forge stages");

const forgePack = path.join(tmp, "forge-pack");
fs.mkdirSync(forgePack, { recursive: true });
fs.writeFileSync(
  path.join(forgePack, "02-plan.md"),
  "# Plan\n\n## Test surface\n\n- the denied role writes nothing\n- the total is in cents\n\n## Out of scope\n\n- exports\n",
);
check(
  "the test surface is read from its heading",
  testSurface(forgePack) === "the denied role writes nothing\nthe total is in cents",
);
fs.writeFileSync(
  path.join(forgePack, "02-plan.md"),
  "- **Approach**: x\n- **Test surface**: the flag-off path is unchanged\n- **Flag**: y\n",
);
check(
  "the test surface is read from a bold label",
  testSurface(forgePack) === "the flag-off path is unchanged",
);

const unitsJson = path.join(forgePack, "units.json");
const testFile = "src/server/api/tests/claims/create-claim.usecase.test.ts";
fs.writeFileSync(
  unitsJson,
  JSON.stringify({
    units: [
      {
        file: testFile,
        sources: ["src/server/api/modules/claims/create-claim.usecase.ts"],
        rows: [{ matrixKey: "U1", rowKey: "R01" }],
        focusLines: [1],
      },
    ],
  }),
);
const units = readUnits(unitsJson);
check("a valid unit list is read", Array.isArray(units) && units.length === 1);
fs.writeFileSync(
  path.join(forgePack, "bad-units.json"),
  JSON.stringify({ units: [{ file: "src/server/api/modules/claims/create-claim.usecase.ts" }] }),
);
check(
  "a unit that is not a test file is refused",
  typeof readUnits(path.join(forgePack, "bad-units.json")) === "string",
);

const item = (predicate: "D1" | "D2" | "D4" | "D5" | "D7" | "D9", ref: string, reason = "r") => ({
  predicate,
  predicateName: "SYNTAX" as const,
  gate: 1 as const,
  gateName: "g",
  ref,
  reason,
  location: ref,
});
const routed = routeWork(
  Array.isArray(units) ? units : [],
  [
    item("D1", testFile),
    item("D2", `${testFile}::RULE-1`, "rule RULE-1 of aspect a carries no verdict for this file"),
    item("D4", `${testFile}::denies a client`),
    item("D4", `${testFile}::returns the total`),
    item("D7", "U1|R01|events"),
    item("D9", "1"),
    item("D5", "17"),
  ],
  new Set([`${testFile}::returns the total`]),
);
check("a syntax item, a ruled red test, a cell and a focus line go to the author", routed.byFile.get(testFile)?.length === 4);
check("a file with no verdict goes to an inspector", routed.inspect.has(testFile));
check("an unruled red test goes to the verifier", routed.verify.length === 1);
check("a mutant item is left to the mutation stage", routed.unrouted.length === 1);

check(
  "a test author may write a test file",
  testWriteRefusal("Write", { file_path: testFile }, "/repo") === undefined,
);
check(
  "a test author may not write production code",
  testWriteRefusal("Edit", { file_path: "src/server/api/modules/claims/create-claim.usecase.ts" }, "/repo") !== undefined,
);
check(
  "a test author may not run git",
  testWriteRefusal("Bash", { command: "yarn vitest run x && git stash" }, "/repo") !== undefined,
);

const gitRefused = (command: string): boolean => testWriteRefusal("Bash", { command }, "/repo") !== undefined;
for (const command of [
  "git status",
  "/usr/bin/git log",
  "env git status",
  "env -i FOO=1 git status",
  "env -u HOME git status",
  "command git status",
  "sudo git reset --hard",
  "xargs git add",
  "ls | xargs -n 1 git rm",
  "exec git push",
  "nohup git gc",
  "time git status",
  "sh -c \"git stash\"",
  "bash -lc 'git checkout .'",
  "eval \"git commit -am x\"",
  "echo hi; git stash",
  "yarn vitest run x || git stash",
  "echo $(git rev-parse HEAD)",
  "echo `git rev-parse HEAD`",
  "if true; then git status; fi",
  "find . -name x -exec git add {} +",
  "\"git\" status",
]) {
  check(`a test author may not run: ${command}`, gitRefused(command));
}
for (const command of [
  "yarn vitest run tests/git-utils.test.ts",
  "grep -r gitignore .",
  "cat .gitignore",
  "echo digit",
  "npx vitest run src/legit.test.ts",
  "sh -c \"yarn vitest run tests/git-utils.test.ts\"",
]) {
  check(`a test author may run: ${command}`, !gitRefused(command));
}

section("the write audit");

const auditRepo = fs.mkdtempSync(path.join(tmp, "audit-"));
const gitIn = (...args: string[]): string =>
  execFileSync("git", ["-C", auditRepo, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
const writeIn = (file: string, text: string): void => {
  const absolute = path.join(auditRepo, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text);
};
const readIn = (file: string): string => fs.readFileSync(path.join(auditRepo, file), "utf8");
gitIn("init", "-q");
writeIn("src/a.ts", "a0\n");
writeIn("src/b.ts", "b0\n");
writeIn("tests/a.test.ts", "t0\n");
gitIn("add", "-A");
gitIn("commit", "-q", "-m", "base");

const auditBase = takeWriteSnapshot(auditRepo);
check("a clean tree has no snapshot entries", auditBase.states.size === 0);
writeIn("tests/a.test.ts", "t1\n");
writeIn("tests/new.test.ts", "t2\n");
check(
  "changing only test files is no violation",
  diffWriteSnapshots(auditBase, takeWriteSnapshot(auditRepo)).length === 0,
);

writeIn("src/a.ts", "a1\n");
writeIn("src/created.ts", "new\n");
fs.rmSync(path.join(auditRepo, "src/b.ts"));
const dirty = takeWriteSnapshot(auditRepo);
check(
  "a changed, a new and a removed production file are all violations",
  diffWriteSnapshots(auditBase, dirty).join(",") === "src/a.ts,src/b.ts,src/created.ts",
);
restoreWriteSnapshot(auditRepo, auditBase, diffWriteSnapshots(auditBase, dirty));
check("restore returns the changed file", readIn("src/a.ts") === "a0\n");
check("restore returns the removed file", readIn("src/b.ts") === "b0\n");
check("restore deletes the new file", !fs.existsSync(path.join(auditRepo, "src/created.ts")));
check("restore never touches test files", readIn("tests/a.test.ts") === "t1\n" && readIn("tests/new.test.ts") === "t2\n");
check("after restore no production violation remains", diffWriteSnapshots(auditBase, takeWriteSnapshot(auditRepo)).length === 0);

writeIn("src/a.ts", "a-user-edit\n");
writeIn("src/scratch.ts", "user-new\n");
const withUserWork = takeWriteSnapshot(auditRepo);
writeIn("tests/a.test.ts", "t3\n");
check(
  "a production file modified before the worker and left alone is no violation",
  diffWriteSnapshots(withUserWork, takeWriteSnapshot(auditRepo)).length === 0,
);
writeIn("src/a.ts", "a-worker-edit\n");
fs.rmSync(path.join(auditRepo, "src/scratch.ts"));
const workerEdit = takeWriteSnapshot(auditRepo);
check(
  "a worker edit over earlier uncommitted work is a violation",
  diffWriteSnapshots(withUserWork, workerEdit).join(",") === "src/a.ts,src/scratch.ts",
);
restoreWriteSnapshot(auditRepo, withUserWork, diffWriteSnapshots(withUserWork, workerEdit));
check(
  "restore returns the earlier uncommitted bytes",
  readIn("src/a.ts") === "a-user-edit\n" && readIn("src/scratch.ts") === "user-new\n",
);

const beforeCommit = takeWriteSnapshot(auditRepo);
gitIn("add", "src/a.ts");
gitIn("commit", "-q", "-m", "worker commit");
const afterCommit = takeWriteSnapshot(auditRepo);
check("a moved HEAD is a violation", diffWriteSnapshots(beforeCommit, afterCommit).includes("HEAD"));
restoreWriteSnapshot(auditRepo, beforeCommit, diffWriteSnapshots(beforeCommit, afterCommit));
check(
  "restore moves HEAD back and keeps the earlier work",
  takeWriteSnapshot(auditRepo).head === beforeCommit.head && readIn("src/a.ts") === "a-user-edit\n",
);
check(
  "violations are listed with a cap",
  describeWriteViolation(["a", "b", "c", "d", "e", "f", "g"]) === "a, b, c, d, e and 2 more",
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

section("stages and the pipeline");

check(
  "the ticket phases run in the new order",
  WORKFLOWS.ticket.phases.join(" ") ===
    "intake grill plan build static test verify record review",
);
check(
  "every ticket phase maps to a stage",
  WORKFLOWS.ticket.phases.every((phase) => STAGE_OF_PHASE[phase] !== undefined),
);
check(
  "intake, grill and plan are the plan stage",
  ["intake", "grill", "plan"].every((phase) => stageOfKey(phase) === "plan"),
);
check(
  "build and static are the implementation stage",
  stageOfKey("build:a#2") === "implementation" && stageOfKey("static") === "implementation",
);
check(
  "every test sub-step is the testing stage",
  stageOfKey("test") === "testing" && stageOfKey("test:write-1:a.test.ts") === "testing",
);
check(
  "verify, record and review are the verification stage",
  ["verify", "record", "review"].every((phase) => stageOfKey(phase) === "verification"),
);

const pipelineStore = new Store(path.join(tmp, "pipeline.sqlite"), "run-pipe");
pipelineStore.startRun("PURCO-1");
pipelineStore.registerSteps(["intake", "plan", "build", "static", "test", "verify", "record", "review"]);
check(
  "a planned step starts pending",
  pipelineStore.pipeline().every((stage) => stage.steps.every((step) => step.status === "pending")),
);
pipelineStore.startPhase("intake", "INTAKE-1");
check(
  "a started step is running",
  pipelineStore.pipeline()[0]?.steps.find((step) => step.key === "intake")?.status === "running",
);
pipelineStore.setWaiting("intake", true);
check(
  "an open item makes its step waiting",
  pipelineStore.pipeline()[0]?.steps.find((step) => step.key === "intake")?.status === "waiting",
);
pipelineStore.setWaiting("intake", false);
check(
  "an answered item puts the step back",
  pipelineStore.pipeline()[0]?.steps.find((step) => step.key === "intake")?.status === "running",
);
const noTokens = { tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0, costUsd: 0, turns: 0 };
pipelineStore.endPhase({ phase: "intake", status: "done", summary: "ok", ...noTokens });
pipelineStore.startPhase("build:a", "BUILDER-a");
pipelineStore.endPhase({ phase: "build:a", status: "escalated", summary: "no result", ...noTokens });
pipelineStore.startPhase("build:a#2", "BUILDER-a#2");
pipelineStore.startPhase("record", "-");
pipelineStore.endPhase({ phase: "record", status: "skipped", summary: MISSING_PAGES_REASON, ...noTokens });
const pipeline = pipelineStore.pipeline();
check("the pipeline lists the four stages in order", pipeline.map((stage) => stage.stage).join(" ") === "plan implementation testing verification");
check("a finished step is done", pipeline[0]?.steps.find((step) => step.key === "intake")?.status === "done");
check(
  "only the latest attempt of a step shows",
  pipeline[1]?.steps.filter((step) => step.baseKey === "build:a").length === 1 &&
    pipeline[1]?.steps.find((step) => step.baseKey === "build:a")?.attempt === 2,
);
check("an escalated attempt is a failed step", pipelineStore.stageSteps("implementation").find((step) => step.key === "build:a")?.status === "failed");
check(
  "the skipped record step keeps its reason",
  pipeline[3]?.steps.find((step) => step.key === "record")?.reason === MISSING_PAGES_REASON,
);
check("a stage with a running step is running", pipeline[1]?.status === "running");
check("a stage with only pending steps is pending", pipeline[2]?.status === "pending");

section("the ticket size");

const small = sizeFor({ filesNamed: 2, backend: true, frontend: false, migration: false, flag: false, acceptanceCriteria: 2 });
check("two files, one side, two criteria is S", small.size === "S");
check("S gives a reason", small.reasons.length === 1);
const medium = sizeFor({ filesNamed: 3, backend: true, frontend: false, migration: false, flag: false, acceptanceCriteria: 2 });
check("three files is M", medium.size === "M" && medium.reasons[0]?.includes("3 files") === true);
check(
  "a flag is M",
  sizeFor({ filesNamed: 1, backend: true, frontend: false, migration: false, flag: true, acceptanceCriteria: 1 }).size === "M",
);
check(
  "both sides is M",
  sizeFor({ filesNamed: 2, backend: true, frontend: true, migration: false, flag: false, acceptanceCriteria: 1 }).size === "M",
);
check(
  "a migration is L",
  sizeFor({ filesNamed: 1, backend: true, frontend: false, migration: true, flag: false, acceptanceCriteria: 1 }).size === "L",
);
check(
  "both sides over five files is L",
  sizeFor({ filesNamed: 6, backend: true, frontend: true, migration: false, flag: false, acceptanceCriteria: 3 }).size === "L",
);
check(
  "five files on both sides is M",
  sizeFor({ filesNamed: 5, backend: true, frontend: true, migration: false, flag: false, acceptanceCriteria: 3 }).size === "M",
);
check(
  "seven criteria is L",
  sizeFor({ filesNamed: 1, backend: false, frontend: true, migration: false, flag: false, acceptanceCriteria: 7 }).size === "L",
);
check(
  "intake counts become facts",
  (() => {
    const facts = factsFromCounts({ files_named: 4, backend: 1, frontend: 0, migration: 0, flag: 1, acceptance_criteria: 3 });
    return !("missing" in facts) && facts.filesNamed === 4 && facts.backend && !facts.frontend && facts.flag;
  })(),
);
check(
  "missing intake counts are named",
  (() => {
    const facts = factsFromCounts({ files_named: 4 });
    return "missing" in facts && facts.missing.includes("migration");
  })(),
);
check("S with two briefs is raised to M", sizeForBriefs(2) === "M" && raiseSize("S", sizeForBriefs(2), "two briefs").raised);
check("M with four briefs is raised to L", sizeForBriefs(4) === "L" && raiseSize("M", sizeForBriefs(4), "four briefs").size === "L");
check("the size never goes down", !raiseSize("L", sizeForBriefs(1), "one brief").raised && raiseSize("L", "S", "x").size === "L");
check("M with three briefs stays M", !raiseSize("M", sizeForBriefs(3), "three briefs").raised);
check(
  "a one-word answer sets the size",
  parseSizeAnswer("L") === "L" && parseSizeAnswer("approve size m") === "M" && parseSizeAnswer("S.") === "S",
);
check("an ordinary answer sets no size", parseSizeAnswer("approve") === undefined && parseSizeAnswer("make it small") === undefined);
check("only L runs full depth", testDepthFor("L") === "full" && testDepthFor("M") === "quick" && testDepthFor("S") === "quick");
pipelineStore.setSize("M", "three files named");
check("the size is stored on the ticket", pipelineStore.size()?.size === "M" && pipelineStore.size()?.reason === "three files named");

section("the ticket lease");

const leaseDb = path.join(tmp, "lease.sqlite");
const leaseA = new Store(leaseDb, "run-a");
const leaseB = new Store(leaseDb, "run-b");
leaseA.bindTicket("PURCO-2");
leaseB.bindTicket("PURCO-2");
let clock = Date.parse("2026-10-07T10:00:00Z");
const alive = new Set<number>([111, 222]);
const held = acquireLease(leaseA, { pid: 111, host: "h", now: () => clock, alive: (pid) => alive.has(pid), heartbeatMs: 3_600_000 });
check("a free lease is taken", leaseA.lease()?.runId === "run-a");
let refusal = "";
try {
  acquireLease(leaseB, { pid: 222, host: "h", now: () => clock, alive: (pid) => alive.has(pid), heartbeatMs: 3_600_000 });
} catch (error) {
  refusal = String(error);
}
check("a live holder refuses a second run", refusal.includes("run-a") && refusal.includes("already running"), refusal);
clock += 120_000;
let staleRefusal = "";
try {
  acquireLease(leaseB, { pid: 222, host: "h", now: () => clock, alive: (pid) => alive.has(pid), heartbeatMs: 3_600_000 });
} catch (error) {
  staleRefusal = String(error);
}
check("a silent holder with a live pid keeps the lease", staleRefusal.includes("run-a"));
alive.delete(111);
leaseA.startRun("PURCO-2");
const stolen = acquireLease(leaseB, { pid: 222, host: "h", now: () => clock, alive: (pid) => alive.has(pid), heartbeatMs: 3_600_000 });
check("a silent holder with a dead pid loses the lease", leaseB.lease()?.runId === "run-b" && stolen.stolenFrom?.runId === "run-a");
check("the dead run is marked dead", leaseA.runStatus()?.status === "dead");
stolen.release();
check("a released lease is free", leaseB.lease() === undefined);
held.release();
const freshDead = acquireLease(leaseA, { pid: 111, host: "h", now: () => clock, alive: () => false, heartbeatMs: 3_600_000 });
let freshRefusal = "";
try {
  acquireLease(leaseB, { pid: 222, host: "h", now: () => clock + 10_000, alive: () => false, heartbeatMs: 3_600_000 });
} catch (error) {
  freshRefusal = String(error);
}
check("a fresh heartbeat keeps the lease even when the pid looks dead", freshRefusal.includes("run-a"));
freshDead.release();
leaseA.close();
leaseB.close();

section("the lead brief");

const briefPack = path.join(tmp, "brief-pack");
fs.mkdirSync(briefPack, { recursive: true });
fs.writeFileSync(
  path.join(briefPack, "03-decisions.md"),
  [
    "# Decisions",
    "",
    "- Use FEATURE_FLAGS.NEW_PAYOUT for the payout change.",
    "- The usecase in src/server/api/modules/claims/create-claim.usecase.ts keeps its input shape.",
    "- Names follow backend-no-barrel-files.",
    "- Unrelated: the export is out of scope.",
    "- [ ] Who owns the backfill for src/server/api/modules/claims/create-claim.usecase.ts?",
    "",
  ].join("\n"),
);
const eventBody = "Step: test:map\nThe author asks about src/server/api/modules/claims/create-claim.usecase.ts and FEATURE_FLAGS.NEW_PAYOUT under backend-no-barrel-files.";
const subjects = extractSubjects(eventBody);
check("a file path is a subject", subjects.includes("src/server/api/modules/claims/create-claim.usecase.ts"));
check("a flag is a subject, with its bare name", subjects.includes("FEATURE_FLAGS.NEW_PAYOUT") && subjects.includes("NEW_PAYOUT"));
check("a rule id is a subject", subjects.includes("backend-no-barrel-files"));
check("a step key is a subject", subjects.includes("test:map"));
const lines = settledDecisionLines(fs.readFileSync(path.join(briefPack, "03-decisions.md"), "utf8"), subjects);
check("every settled line that names a subject is picked", lines.length === 3, String(lines.length));
check("an unrelated line is left out", !lines.some((line) => line.startsWith("- Unrelated")));
check("an open line is never settled", !lines.some((line) => line.includes("[ ]")));

const briefStore = new Store(path.join(tmp, "brief.sqlite"), "run-brief");
briefStore.startRun("PURCO-3");
briefStore.registerSteps(["intake", "plan", "build:a", "static", "test"]);
const stored = (summary: string): StepResult => ({ status: "delivered", summary, produced: [], openQuestions: 0, counts: { files_named: 2 } });
for (const key of ["intake", "plan"]) {
  briefStore.startPhase(key, "X");
  briefStore.endPhase({ phase: key, status: "done", summary: key, ...noTokens });
}
briefStore.recordResult("intake", stored("intake result"));
briefStore.startPhase("test", "TEST-FORGE");
briefStore.recordDecision({
  step: "test",
  kind: "question",
  subjects: ["NEW_PAYOUT"],
  question: "Which payout?",
  brief: "b",
  decision: "answer",
  text: "Use the new payout.",
});
briefStore.recordDecision({
  step: "test",
  kind: "question",
  subjects: ["src/other.ts"],
  question: "Other?",
  brief: "b",
  decision: "answer",
  text: "Unrelated answer.",
});
briefStore.askQuestion("Q-1", "TEST-AUTHOR", "test", "question", "Open test question?");
briefStore.askQuestion("Q-2", "PLANNER", "plan", "question", "Open plan question?");
const missingBrief = buildBrief({ kind: "question", body: eventBody, stepKey: "test", pack: briefPack, store: briefStore });
check("a done step with no stored result is reported missing", missingBrief.missing.join(",") === "plan", missingBrief.missing.join(","));
briefStore.recordResult("plan", stored("plan result"));
const brief = buildBrief({ kind: "question", body: eventBody, stepKey: "test", pack: briefPack, store: briefStore });
check("no result is missing once stored", brief.missing.length === 0);
check("the brief starts with the event body", brief.text.startsWith(eventBody));
check("the brief holds the settled lines", brief.text.includes("FEATURE_FLAGS.NEW_PAYOUT for the payout change"));
check("the brief holds an earlier decision on the same subject", brief.text.includes("Use the new payout."));
check("the brief leaves out a decision on another subject", !brief.text.includes("Unrelated answer."));
check("the brief holds the open items of the stage only", brief.text.includes("Open test question?") && !brief.text.includes("Open plan question?"));
check("the brief holds the full result of the plan step", brief.text.includes('"summary": "plan result"') && brief.text.includes('"files_named": 2'));
check("the brief takes only the plan step from the plan stage", brief.text.includes('"summary": "intake result"') === false);
briefStore.close();

section("the structured handoff");

const goodHandoff = parseHandoff({
  status: "delivered",
  summary: "did it",
  produced: ["a.md"],
  counts: { files_named: 3 },
  findings: [{ title: "t", severity: "high", location: "a.ts:1" }],
});
check("a well formed handoff is accepted", goodHandoff.ok && goodHandoff.result.counts?.files_named === 3);
const badCounts = parseHandoff({ status: "delivered", summary: "x", counts: { files_named: "three" } });
check("a count that is not a number is refused with a fix", !badCounts.ok && badCounts.fix.includes("counts"), JSON.stringify(badCounts));
const badFinding = parseHandoff({ status: "delivered", summary: "x", findings: [{ title: "t" }] });
check("a finding without a location is refused", !badFinding.ok && badFinding.fix.includes("findings"));
check("an empty summary is refused", !parseHandoff({ status: "delivered", summary: "" }).ok);
check("an unknown status is refused", !parseHandoff({ status: "done", summary: "x" }).ok);
const noEvidence = parseHandoff({ status: "blocked", summary: "x" });
check("a blocked handoff needs evidence", !noEvidence.ok && noEvidence.fix.includes("evidence"));

section("worker telemetry: usage and cost");

const sonnetUsage = { input: 1000, output: 500, cacheRead: 10000, cacheCreation: 2000 };
check("a message costs its tokens at the list price", messageCost(MODELS.sonnet, sonnetUsage) === 0.017);
check("an opus message costs its tokens at the list price", messageCost(MODELS.opus, sonnetUsage) === 0.032);
check("an unknown model costs nothing until the final cost corrects it", messageCost("other-model", sonnetUsage) === 0);
const ledger = new UsageLedger();
check("a new message id is counted", ledger.add("m1", MODELS.sonnet, sonnetUsage));
check("a repeated message id with the same usage changes nothing", !ledger.add("m1", MODELS.sonnet, sonnetUsage));
check("a repeated message id with more output is merged", ledger.add("m1", MODELS.sonnet, { ...sonnetUsage, output: 800 }));
ledger.add("m2", MODELS.sonnet, { input: 10, output: 20, cacheRead: 30, cacheCreation: 40 });
const ledgerTotals = ledger.totals();
check("duplicate ids are counted once", ledgerTotals.turns === 2);
check("tokens add across distinct messages", ledgerTotals.usage.input === 1010 && ledgerTotals.usage.output === 820 && ledgerTotals.usage.cacheRead === 10030 && ledgerTotals.usage.cacheCreation === 2040);
check("context size is the last message input plus cache read plus cache write", ledgerTotals.contextTokens === 80 && contextSize({ input: 5, output: 99, cacheRead: 6, cacheCreation: 7 }) === 18);

section("worker telemetry: burn rate");

check("burn rate is tokens per minute over the window", burnRate([{ atMs: 0, tokens: 0 }, { atMs: 60_000, tokens: 60_000 }, { atMs: 120_000, tokens: 120_000 }], 120_000) === 60_000);
check("samples older than the window are ignored", burnRate([{ atMs: 0, tokens: 0 }, { atMs: 200_000, tokens: 1000 }, { atMs: 260_000, tokens: 61_000 }], 260_000) === 60_000);
check("one sample gives no rate", burnRate([{ atMs: 100, tokens: 5 }], 200) === undefined);
check("a span under 30 seconds gives no rate", burnRate([{ atMs: 0, tokens: 0 }, { atMs: 20_000, tokens: 9_999_999 }], 20_000) === undefined);
check("the median of an even list is the mean of the middle pair", median([10, 40, 20, 30]) === 25);
check("history under 3 samples uses the role default", normalRate([1000, 2000], "builder") === 90_000);
check("history of 3 or more uses its median", normalRate([30_000, 60_000, 90_000], "builder") === 60_000);
check("an unknown role uses the fallback default", normalRate([], "mystery") === 60_000);
check("below 2x is no alert", evaluateBurn({ rate: 119_999, normal: 60_000, nowMs: 0 }).level === 0);
check("2x raises level 2 without stopping", evaluateBurn({ rate: 120_000, normal: 60_000, nowMs: 0 }).level === 2);
const firstOver3 = evaluateBurn({ rate: 180_000, normal: 60_000, nowMs: 5_000 });
check("3x starts the clock and does not stop at once", firstOver3.level === 3 && firstOver3.over3Since === 5_000 && !firstOver3.stop);
check("3x for 2 minutes stops the worker", evaluateBurn({ rate: 200_000, normal: 60_000, over3Since: 5_000, nowMs: 125_000 }).stop);
check("3x for under 2 minutes does not stop", !evaluateBurn({ rate: 200_000, normal: 60_000, over3Since: 5_000, nowMs: 124_999 }).stop);
const droppedBack = evaluateBurn({ rate: 130_000, normal: 60_000, over3Since: 5_000, nowMs: 125_000 });
check("falling under 3x resets the clock", droppedBack.level === 2 && droppedBack.over3Since === undefined && !droppedBack.stop);

section("worker telemetry: stuck and loop");

const MINUTE = 60_000;
check("5 minutes without activity raises the alert", evaluateStuck({ state: "thinking", lastActivityMs: 0, nowMs: 5 * MINUTE }).alert);
check("4 minutes without activity is not stuck", !evaluateStuck({ state: "tool", lastActivityMs: 0, nowMs: 4 * MINUTE }).alert);
check("10 minutes after the alert the worker stops", evaluateStuck({ state: "thinking", lastActivityMs: 0, alertedAtMs: 5 * MINUTE, nowMs: 15 * MINUTE }).stop);
check("9 minutes after the alert the worker keeps going", !evaluateStuck({ state: "thinking", lastActivityMs: 0, alertedAtMs: 5 * MINUTE, nowMs: 14 * MINUTE }).stop);
check("a running Bash command is not stuck after 19 minutes", !evaluateStuck({ state: "tool", action: "Bash yarn test", lastActivityMs: 0, nowMs: 19 * MINUTE }).alert);
check("a running Bash command raises the alert at 20 minutes", evaluateStuck({ state: "tool", action: "Bash yarn test", lastActivityMs: 0, nowMs: 20 * MINUTE }).alert);
check("a Bash worker keeps going 19 minutes after the alert", !evaluateStuck({ state: "tool", action: "Bash yarn test", lastActivityMs: 0, alertedAtMs: 20 * MINUTE, nowMs: 39 * MINUTE }).stop);
check("a Bash worker stops 40 minutes in", evaluateStuck({ state: "tool", action: "Bash yarn test", lastActivityMs: 0, alertedAtMs: 20 * MINUTE, nowMs: 40 * MINUTE }).stop);
check("a non-Bash tool keeps the 5 minute limit", evaluateStuck({ state: "tool", action: "Read src/a.ts", lastActivityMs: 0, nowMs: 5 * MINUTE }).alert);
check("a thinking worker with a Bash action keeps the 5 minute limit", evaluateStuck({ state: "thinking", action: "Bash yarn test", lastActivityMs: 0, nowMs: 5 * MINUTE }).alert);
check("a waiting worker is never stuck", !evaluateStuck({ state: "waiting-human", lastActivityMs: 0, nowMs: 60 * MINUTE }).alert);
check("new activity resets the alert", evaluateStuck({ state: "thinking", lastActivityMs: 14 * MINUTE, alertedAtMs: 5 * MINUTE, nowMs: 15 * MINUTE }).reset);
check("the call signature ignores key order", callSignature("Read", { a: 1, b: { c: 2, d: 3 } }) === callSignature("Read", { b: { d: 3, c: 2 }, a: 1 }));
check("the call signature depends on the tool and the input", callSignature("Read", { a: 1 }) !== callSignature("Grep", { a: 1 }) && callSignature("Read", { a: 1 }) !== callSignature("Read", { a: 2 }));
const sig = callSignature("Bash", { command: "yarn tsc" });
const twice = nextLoopState(nextLoopState(undefined, sig), sig);
check("two identical calls are not a loop", !isLoop(twice));
check("three identical calls in a row are a loop", isLoop(nextLoopState(twice, sig)));
check("a different call breaks the run", !isLoop(nextLoopState(nextLoopState(twice, callSignature("Read", {})), sig)));

section("worker telemetry: store, rollup, alerts, watchdog");

const T0 = Date.parse("2026-10-07T10:00:00.000Z");
const telemetryStore = new Store(path.join(tmp, "telemetry.db"), "run-t");
telemetryStore.bindTicket("PURCO-9");
telemetryStore.startRun("PURCO-9");

const fakeRow = (id: string, step: string, costUsd: number, tokensIn: number): WorkerRow => ({
  id,
  ticket: "PURCO-9",
  runId: "run-t",
  step,
  label: id,
  role: "builder",
  model: MODELS.sonnet,
  state: "done",
  action: "",
  tokensIn,
  tokensOut: 10,
  cacheRead: 100,
  cacheWrite: 5,
  costUsd,
  turns: 2,
  maxTurns: 10,
  contextTokens: 0,
  filesRead: ["a.ts"],
  filesWritten: [],
  startedAt: "2026-10-07T10:00:00.000Z",
  lastEventAt: "2026-10-07T10:00:00.000Z",
  lastActivityAt: "2026-10-07T10:00:00.000Z",
  endedAt: "2026-10-07T10:05:00.000Z",
});
const rows = [
  fakeRow("w1", "build:a", 0.5, 1000),
  fakeRow("w2", "build:a", 0.25, 2000),
  fakeRow("w3", "test:unit", 1.25, 3000),
];
const rolled = rollupCosts(rows);
check("the ticket total adds every worker", rolled.ticket.costUsd === 2 && rolled.ticket.tokensIn === 6000 && rolled.ticket.workers === 3);
check("a stage total adds its steps", rolled.stages.implementation.costUsd === 0.75 && rolled.stages.testing.costUsd === 1.25 && rolled.stages.plan.costUsd === 0);
check("a step total adds its workers", rolled.steps["build:a"]?.costUsd === 0.75 && rolled.steps["build:a"]?.workers === 2);
check("each worker has its own total", rolled.workers.map((w) => `${w.id}:${w.costUsd}`).join(",") === "w1:0.5,w2:0.25,w3:1.25");
for (const row of rows) telemetryStore.saveWorker(row);
const storedRollup = telemetryStore.costRollup("PURCO-9");
check("the store rolls up the stored workers", storedRollup.ticket.costUsd === 2 && storedRollup.stages.testing.workers === 1);
check("a stored worker keeps its file lists", telemetryStore.workers("PURCO-9")[0]?.filesRead.join(",") === "a.ts");
check("finished workers give a rate history for their role", telemetryStore.finishedRates("builder").length === 3);
check("finished workers are not live", telemetryStore.liveWorkers("PURCO-9").length === 0);

const sent: string[] = [];
const alerts = new Alerts(telemetryStore, "run-t", "PURCO-9", (ticket, title, subtitle) => {
  sent.push(`${ticket}|${title}|${subtitle ?? ""}`);
});
check("a first alert is stored and notified", alerts.raise("stuck", "BUILDER-a is stuck", { workerId: "w1", step: "build:a", title: "Builder a stuck 5 min", dedupeKey: "w1:stuck" }));
check("the same alert key is not raised twice", !alerts.raise("stuck", "BUILDER-a is stuck", { workerId: "w1", step: "build:a", title: "Builder a stuck 5 min", dedupeKey: "w1:stuck" }));
check("an alert with another level is raised", alerts.raise("burn", "BUILDER-a burns", { workerId: "w1", step: "build:a", title: "Builder a · 2× normal (120k/min)", dedupeKey: "w1:burn:2" }));
check("alerts without a key are never merged", alerts.raise("gate", "plan gate", { step: "plan", title: "Plan gate waits" }) && alerts.raise("gate", "plan gate", { step: "plan", title: "Plan gate waits" }));
check("one notification per stored alert", sent.length === 4 && sent[0] === "PURCO-9|Builder a stuck 5 min|BUILDER-a is stuck");
const unseen = telemetryStore.alerts("PURCO-9", true);
check("the store lists unseen alerts", unseen.length === 4 && unseen[0]?.kind === "stuck" && unseen[0]?.workerId === "w1");
telemetryStore.markAlertsSeen(unseen.slice(0, 2).map((alert) => alert.id));
check("marking alerts seen removes them from the unseen list", telemetryStore.alerts("PURCO-9", true).length === 2 && telemetryStore.alerts("PURCO-9", false).length === 4);
check("the notification script escapes quotes and backslashes", notificationScript('T"1', 'say "hi" \\ now') === 'display notification "say \\"hi\\" \\\\ now" with title "purco T\\"1"');
check("the notification script adds a subtitle when given", notificationScript("T1", "Title", "short") === 'display notification "Title" with title "purco T1" subtitle "short"');
check("a short message becomes the subtitle", notificationSubtitle("Title", "short message") === "short message");
check("a long message or a repeated title gives no subtitle", notificationSubtitle("Title", "x".repeat(200)) === undefined && notificationSubtitle("Title", "Title") === undefined);
check("the store keeps the alert title", telemetryStore.alerts("PURCO-9", false)[0]?.title === "Builder a stuck 5 min");

check("short names drop directories and long suffixes", shortName("create-bill-for-payee.usecase.test.ts") === "create-bill" && shortName("tests/usecases/bills/create-bill-for-payee.usecase.test.ts") === "create-bill" && shortName("build:a") === "a");
const planPayload = { type: "test-plan", runId: 42, units: [{ rows: 120 }, { rows: 80 }, { rows: 0 }, { rows: 0 }] };
check("a test plan gate title counts files and rows", gateTitle("test", planPayload) === "Test plan waits · run 42 · 4 files · 200 rows");
check("another gate names its step", gateTitle("plan:x") === "X gate waits" && gateTitle("intake") === "Intake gate waits");
check("a question title names the role and cuts the text", questionTitle("builder", "x".repeat(80)) === `Builder asks: ${"x".repeat(49)}…` && questionTitle("lead", "Which table?") === "Lead asks: Which table?");
check("a sign title counts waivers or names equivalence", signTitle("Test Forge run 3 asks you to sign 2 waiver(s).") === "Signature needed: 2 waiver(s)" && signTitle("3 mutant(s) survived") === "Signature needed: equivalence");
check("a burn title shows the factor and the rate", burnTitle({ role: "builder", step: "build:create-bill-for-payee.usecase.test.ts", level: 2, rate: 120_000 }) === "Builder create-bill · 2× normal (120k/min)");
check("stuck, loop, halted and done titles are short", stuckTitle({ role: "tester", step: "test:plan", minutes: 5 }) === "Tester plan stuck 5 min" && loopTitle("Read") === "loop: Read" && haltedTitle("burn rate") === "halted: burn rate" && doneTitle(12.345) === "Ticket done · $12.35");
check("a long halted reason is cut to 70 characters", haltedTitle("x".repeat(200)).length === 70);
check("human titles route by kind", humanTitle("sign", { text: "sign 1 waiver(s)", step: "s" }) === "Signature needed: 1 waiver(s)" && humanTitle("question", { text: "why", step: "s", role: "builder" }) === "Builder asks: why" && humanTitle("gate", { text: "t", step: "s", payload: planPayload }).startsWith("Test plan waits"));
check("an old alert falls back to the first line of its message cut to 80", fallbackTitle(`first line\nsecond ${"y".repeat(100)}`) === "first line" && fallbackTitle("z".repeat(200)).length === 80);

const legacyPath = path.join(tmp, "legacy-alerts.sqlite");
const legacyDb = new DatabaseSync(legacyPath);
legacyDb.exec("create table alerts (id integer primary key autoincrement, ticket text not null, run_id text not null, worker_id text, step text not null, kind text not null, message text not null, at text not null, seen integer not null default 0, dedupe_key text)");
legacyDb.prepare("insert into alerts (ticket, run_id, step, kind, message, at) values ('PURCO-1', 'r', 'plan', 'gate', ?, '2026-01-01T00:00:00.000Z')").run("Plan card\nfile one\nfile two");
legacyDb.close();
check("a read-only store gives an old alert a title from its message", Store.openReadOnly(legacyPath, "PURCO-1").alerts("PURCO-1", false)[0]?.title === "Plan card");

let telemetryClock = T0;
const loops: string[] = [];
const meter = new WorkerMeter(
  {
    store: telemetryStore,
    now: () => telemetryClock,
    onLoop: (row, tool) => {
      loops.push(`${row.label}:${tool}`);
    },
  },
  { runId: "run-t", ticket: "PURCO-9", step: "build:z", label: "BUILDER-z", role: "builder", model: MODELS.sonnet, maxTurns: 30 },
);
check("a new worker is live and starting", telemetryStore.liveWorkers("PURCO-9").map((w) => `${w.label}:${w.state}`).join(",") === "BUILDER-z:starting");
meter.toolStart("Read", { file_path: "/x/a.ts" });
check("a tool use sets the state, the action and the files read", telemetryStore.liveWorkers("PURCO-9")[0]?.state === "tool" && telemetryStore.liveWorkers("PURCO-9")[0]?.action === "Read file_path=/x/a.ts" && telemetryStore.liveWorkers("PURCO-9")[0]?.filesRead.join(",") === "/x/a.ts");
meter.toolEnd("Read", { file_path: "/x/a.ts" });
meter.toolStart("Read", { file_path: "/x/a.ts" });
check("two identical calls raise no loop", loops.length === 0);
meter.toolStart("Read", { file_path: "/x/a.ts" });
meter.toolStart("Read", { file_path: "/x/a.ts" });
meter.toolStart("Read", { file_path: "/x/a.ts" });
check("three identical calls in a row raise one loop", loops.join(",") === "BUILDER-z:Read");
meter.waiting("waiting-lead");
check("a waiting worker shows its waiting state", telemetryStore.liveWorkers("PURCO-9")[0]?.state === "waiting-lead");
meter.resume();
check("it goes back to its earlier state", telemetryStore.liveWorkers("PURCO-9")[0]?.state === "tool");
const sampleCountBefore = telemetryStore.samples("PURCO-9", "2026-01-01T00:00:00.000Z").length;
telemetryClock = T0 + 5_000;
meter.toolEnd("Write", { file_path: "/x/out.ts" });
meter.toolStart("Write", { file_path: "/x/out.ts" });
check("a file written is recorded", telemetryStore.liveWorkers("PURCO-9")[0]?.filesWritten.join(",") === "/x/out.ts");
check("samples are not written more than every 10 seconds", telemetryStore.samples("PURCO-9", "2026-01-01T00:00:00.000Z").length === sampleCountBefore);

const halts: string[] = [];
const watchdog = new Watchdog({
  store: telemetryStore,
  alerts,
  ticket: "PURCO-9",
  runId: "run-t",
  now: () => telemetryClock,
  halt: (id, reason) => {
    halts.push(`${id}:${reason}`);
  },
});
const burstSample = (offsetMs: number, tokens: number): void =>
  telemetryStore.recordSample({ workerId: meter.id, ticket: "PURCO-9", at: new Date(T0 + offsetMs).toISOString(), tokens, costUsd: 0 });
meter.toolEnd("Read", { file_path: "/x/b.ts" });
const alertsBefore = telemetryStore.alerts("PURCO-9", false).length;
burstSample(60_000, 300_000);
telemetryClock = T0 + 60_000;
watchdog.tick();
const burnAlerts = telemetryStore.alerts("PURCO-9", false).filter((alert) => alert.kind === "burn" && alert.workerId === meter.id);
check("a 3x burn raises one burn alert and does not stop yet", burnAlerts.length === 1 && halts.length === 0 && telemetryStore.alerts("PURCO-9", false).length === alertsBefore + 1);
burstSample(120_000, 600_000);
telemetryClock = T0 + 120_000;
watchdog.tick();
check("the same level is not alerted again", telemetryStore.alerts("PURCO-9", false).filter((alert) => alert.kind === "burn" && alert.workerId === meter.id).length === 1 && halts.length === 0);
burstSample(180_000, 900_000);
telemetryClock = T0 + 180_000;
watchdog.tick();
check("3x for 2 minutes asks the engine to stop the worker", halts.join(",") === `${meter.id}:burn rate`);

const quiet = new WorkerMeter(
  { store: telemetryStore, now: () => telemetryClock, onLoop: () => undefined },
  { runId: "run-t", ticket: "PURCO-9", step: "build:q", label: "BUILDER-q", role: "builder", model: MODELS.sonnet, maxTurns: 30 },
);
meter.halt("burn rate");
check("a halted worker is no longer live and keeps its reason", telemetryStore.liveWorkers("PURCO-9").map((w) => w.label).join(",") === "BUILDER-q" && telemetryStore.workers("PURCO-9").find((w) => w.id === meter.id)?.haltReason === "burn rate");
halts.length = 0;
quiet.toolStart("Grep", { pattern: "x" });
telemetryClock += 6 * MINUTE;
watchdog.tick();
const stuckAlerts = telemetryStore.alerts("PURCO-9", false).filter((alert) => alert.kind === "stuck" && alert.workerId === quiet.id);
check("5 quiet minutes raise a stuck alert", stuckAlerts.length === 1 && halts.length === 0);
telemetryClock += 9 * MINUTE;
watchdog.tick();
check("9 more minutes do not stop it", halts.length === 0);
telemetryClock += 2 * MINUTE;
watchdog.tick();
check("10 minutes after the alert the worker is stopped as stuck", halts.join(",") === `${quiet.id}:stuck`);
telemetryStore.haltStep("build:q", "halted: stuck");
check("a worker waiting for the human is never stuck", (() => {
  halts.length = 0;
  quiet.waiting("waiting-human");
  telemetryClock += 60 * MINUTE;
  watchdog.tick();
  return halts.length === 0;
})());
telemetryStore.close();

const recordWorktree = path.join(tmp, "record-worktree");
const recordPack = path.join(tmp, "record-pack");
fs.mkdirSync(path.join(recordPack, "verify", "flows"), { recursive: true });
fs.mkdirSync(recordWorktree, { recursive: true });
const goodManifest = [
  { file: "01-allocate.spec.ts", criterion: "allocation works", flagState: "ON" },
  { file: "01-allocate-flag-off.spec.ts", criterion: "allocation works", flagState: "OFF" },
  { file: "02-list.spec.ts", criterion: "list shows rows", flagState: "NONE" },
];
const parsedManifest = parseFlowManifest(JSON.stringify(goodManifest));
check("a valid flow manifest parses", parsedManifest.ok && parsedManifest.entries.length === 3);
check("a manifest that is not JSON is refused", !parseFlowManifest("{oops").ok);
check(
  "a manifest with an unknown flag state is refused",
  !parseFlowManifest(JSON.stringify([{ file: "a.spec.ts", criterion: "c", flagState: "MAYBE" }])).ok,
);
check(
  "a manifest entry that climbs out of the flows folder is refused",
  !parseFlowManifest(JSON.stringify([{ file: "../a.spec.ts", criterion: "c", flagState: "NONE" }])).ok,
);
check(
  "a manifest that maps two flows to one video is refused",
  !parseFlowManifest(
    JSON.stringify([
      { file: "01-a.spec.ts", criterion: "c", flagState: "ON" },
      { file: "01-a-flag-on.spec.ts", criterion: "c", flagState: "ON" },
    ]),
  ).ok,
);
check(
  "the video name follows the number, slug and flag state",
  videoFileName({ file: "01-allocate.spec.ts", criterion: "c", flagState: "ON" }) === "01-allocate-flag-on.webm" &&
    videoFileName({ file: "01-allocate.spec.ts", criterion: "c", flagState: "OFF" }) === "01-allocate-flag-off.webm" &&
    videoFileName({ file: "02-list.spec.ts", criterion: "c", flagState: "NONE" }) === "02-list.webm",
);
check(
  "a flag suffix in the script name is not doubled in the video name",
  videoFileName({ file: "01-allocate-flag-off.spec.ts", criterion: "c", flagState: "OFF" }) === "01-allocate-flag-off.webm",
);
check(
  "the step is skipped when the worktree has no e2e pages",
  recordSkipReason(recordWorktree, recordPack) === MISSING_PAGES_REASON,
);
fs.mkdirSync(path.join(recordWorktree, "tests", "e2e", "pages"), { recursive: true });
check("the step is skipped when verify wrote no manifest", recordSkipReason(recordWorktree, recordPack) === NO_FLOWS_REASON);
fs.writeFileSync(path.join(recordPack, "verify", "flows", "flows.json"), "[]");
check("the step is skipped when the manifest is empty", recordSkipReason(recordWorktree, recordPack) === NO_FLOWS_REASON);
fs.writeFileSync(path.join(recordPack, "verify", "flows", "flows.json"), JSON.stringify(goodManifest));
check("the step runs when the pages and the manifest exist", recordSkipReason(recordWorktree, recordPack) === undefined);

const command = buildPlaywrightCommand({
  worktree: recordWorktree,
  script: "tests/e2e/.purco-recording/01-allocate.spec.ts",
  outputDir: "/out/videos",
  tenant: "sdi",
});
check(
  "the playwright command runs the script with the recording config in the worktree",
  command.command === "npx" &&
    command.cwd === recordWorktree &&
    command.args.join(" ") ===
      `playwright test tests/e2e/.purco-recording/01-allocate.spec.ts -c ${FLOW_CONFIG} --output /out/videos`,
);
check(
  "the playwright command sets the tenant and the local mode",
  JSON.stringify(command.env) === JSON.stringify({ TENANT: "sdi", envmode: "local" }),
);
check("each script gets three minutes", command.timeoutMs === FLOW_TIMEOUT_MS && FLOW_TIMEOUT_MS === 180_000);

for (const entry of goodManifest) fs.writeFileSync(path.join(recordPack, "verify", "flows", entry.file), "");
const stagedAtRun: string[] = [];
const fakeExecute: Execute = async (run) => {
  stagedAtRun.push(
    [
      fs.existsSync(path.join(recordWorktree, STAGING_DIR, "recording.config.ts")),
      fs.existsSync(path.join(recordWorktree, STAGING_DIR, path.basename(run.args[2] ?? ""))),
    ].join(":"),
  );
  const outputDir = run.args[run.args.length - 1] ?? "";
  if ((run.args[2] ?? "").endsWith("02-list.spec.ts")) return { ok: false, tail: "expected 3 rows, saw 0" };
  fs.mkdirSync(path.join(outputDir, "case"), { recursive: true });
  fs.writeFileSync(path.join(outputDir, "case", "video.webm"), "x");
  return { ok: true, tail: "" };
};
const progress: string[] = [];
const recorded = await recordFlows({
  worktree: recordWorktree,
  pack: recordPack,
  tenant: "purco",
  execute: fakeExecute,
  onProgress: (runs, total, next) => progress.push(`${runs.length}/${total}${next ? ` ${next.file}` : ""}`),
});
const videosDir = path.join(recordPack, "verify", "videos");
check("a failing script fails the step", recorded.status === "failed" && recorded.result?.status === "failed");
check(
  "the result counts flows, videos and failures",
  JSON.stringify(recorded.result?.counts) === JSON.stringify({ flows: 3, videos: 2, failed: 1 }),
);
check(
  "the failing flow and its error tail are in the findings",
  recorded.result?.findings?.length === 1 &&
    recorded.result.findings[0]?.title.startsWith("02-list.spec.ts") === true &&
    recorded.result.findings[0]?.location === "expected 3 rows, saw 0",
);
check(
  "each passing flow leaves one video under its final name",
  fs.readdirSync(videosDir).sort().join(",") === "01-allocate-flag-off.webm,01-allocate-flag-on.webm",
);
check(
  "the videos are listed as produced",
  recorded.result?.produced.map((file) => path.basename(file)).join(",") === "01-allocate-flag-on.webm,01-allocate-flag-off.webm",
);
check(
  "progress is reported before each flow and at the end",
  progress.join("|") === "0/3 01-allocate.spec.ts|1/3 01-allocate-flag-off.spec.ts|2/3 02-list.spec.ts|3/3",
);
check(
  "the library and the script are staged in the worktree while a flow runs",
  stagedAtRun.length === 3 && stagedAtRun.every((state) => state === "true:true"),
);
check(
  "the staged folder is removed from the worktree after the run",
  !fs.existsSync(path.join(recordWorktree, STAGING_DIR)),
);
check(
  "the staged library holds every file of the recorder library",
  fs.readdirSync(LIBRARY_DIR).includes("recording.config.ts") && fs.readdirSync(LIBRARY_DIR).includes("login-as.ts"),
);
const gitWorktree = path.join(tmp, "git-worktree");
fs.mkdirSync(path.join(gitWorktree, "tests", "e2e", "pages"), { recursive: true });
fs.writeFileSync(path.join(gitWorktree, "tests", "e2e", "pages", "page.ts"), "export {}\n");
const git = (...args: string[]) => execFileSync("git", ["-C", gitWorktree, ...args], { encoding: "utf8" });
git("init", "-q");
git("add", "-A");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
fs.writeFileSync(path.join(recordPack, "verify", "flows", "flows.json"), JSON.stringify(goodManifest));
await recordFlows({ worktree: gitWorktree, pack: recordPack, tenant: "purco", execute: fakeExecute });
check("a run leaves the git status of the worktree unchanged", git("status", "--porcelain") === "");
const throwingExecute: Execute = async () => {
  throw new Error("boom");
};
const thrown = await recordFlows({ worktree: gitWorktree, pack: recordPack, tenant: "purco", execute: throwingExecute }).then(
  () => false,
  (error: unknown) => error instanceof Error && error.message === "boom",
);
check(
  "a throwing run still removes the staged folder and leaves the git status unchanged",
  thrown && !fs.existsSync(path.join(gitWorktree, STAGING_DIR)) && git("status", "--porcelain") === "",
);
check(
  "a partial result is blocked and a complete clean one is delivered",
  buildRecordResult([], 0).status === "delivered" && buildRecordResult([], 2).status === "blocked",
);
fs.writeFileSync(path.join(recordPack, "verify", "flows", "flows.json"), "not json");
const brokenManifest = await recordFlows({ worktree: recordWorktree, pack: recordPack, tenant: "purco", execute: fakeExecute });
check("a malformed manifest fails the step", brokenManifest.status === "failed" && brokenManifest.summary.includes("not valid JSON"));

const mechanicalRule = (
  id: string,
  mechanization: MechanicalRule["mechanization"],
  detect: string | null,
  appliesWhen: string | null = null,
): MechanicalRule => ({
  id,
  mechanization,
  severity: "blocking",
  statement: `statement of ${id}`,
  appliesWhen: { human: "", check: appliesWhen },
  detect: { human: "", check: detect },
  violates: { human: `fix for ${id}`, check: null },
});
const outcome = (overrides: Partial<CheckOutcome>): CheckOutcome => ({
  checkId: "r",
  kind: "grep",
  expression: "x",
  evaluable: true,
  applied: true,
  violated: false,
  sites: [],
  siteCount: 0,
  sitesTruncated: false,
  error: null,
  ...overrides,
});
const fullRule = mechanicalRule("R1", "full", "grep:/foo/", "grep:/bar/");
const noAppliesRule = mechanicalRule("R2", "full", "grep:/foo/");
const plan = planMechanical([
  fullRule,
  noAppliesRule,
  mechanicalRule("R3", "partial", "grep:/foo/"),
  mechanicalRule("R4", "judgment", null),
  mechanicalRule("R5", "full", null),
]);
check(
  "only full rules with a runnable detect check are mechanical",
  plan.mechanical.map(({ rule }) => rule.id).join(",") === "R1,R2" &&
    plan.residual.map((rule) => rule.id).join(",") === "R3,R4,R5",
);
check(
  "a mechanical request carries its appliesWhen only when the rule has one",
  plan.mechanical[0]?.request.appliesWhen === "grep:/bar/" &&
    plan.mechanical[1]?.request.appliesWhen === undefined &&
    plan.mechanical[1]?.request.detect === "grep:/foo/",
);
check(
  "an outcome that did not apply is not-applicable",
  judgeOutcome(fullRule, outcome({ applied: false }))?.verdict === "not-applicable",
);
check(
  "a matched detect check is a violation with its sites",
  JSON.stringify(judgeOutcome(fullRule, outcome({ violated: true, sites: [{ line: 7, quote: "foo()" }] }))) ===
    JSON.stringify({ rule: fullRule, verdict: "violation", sites: [{ line: 7, quote: "foo()" }] }),
);
check("an applied and clean outcome passes", judgeOutcome(fullRule, outcome({}))?.verdict === "pass");
check(
  "an errored, unevaluable or missing outcome is not judged",
  judgeOutcome(fullRule, outcome({ error: "boom" })) === undefined &&
    judgeOutcome(fullRule, outcome({ evaluable: false })) === undefined &&
    judgeOutcome(fullRule, undefined) === undefined,
);
const judgements = [
  judgeOutcome(fullRule, outcome({ violated: true, sites: [{ line: 7, quote: "foo()" }, { line: 9, quote: "foo(1)" }] })),
  judgeOutcome(noAppliesRule, outcome({})),
].flatMap((entry) => (entry ? [entry] : []));
const verdicts = verdictsFor("a.test.ts", judgements);
check(
  "each judgement becomes one file verdict from the mechanical post",
  verdicts.length === 2 &&
    verdicts.every(
      (verdict) =>
        verdict.subjectKind === "file" &&
        verdict.subjectRef === "a.test.ts" &&
        verdict.post === "inspector-mechanical" &&
        verdict.agentCallsign === "CODE" &&
        verdict.rubric?.length === 0,
    ) &&
    verdicts[0]?.verdict === "violation" &&
    verdicts[0].sites?.length === 2 &&
    verdicts[1]?.verdict === "pass" &&
    verdicts[1].sites?.length === 0,
);
check(
  "each violation site becomes a finding keyed by rule, file and line",
  JSON.stringify(findingsFor("a.test.ts", judgements).map((finding) => [finding.findingKey, finding.proposedFix, finding.location])) ===
    JSON.stringify([
      ["R1:a.test.ts:7", "fix for R1", "a.test.ts:7"],
      ["R1:a.test.ts:9", "fix for R1", "a.test.ts:9"],
    ]),
);

const reviewer = ROLE_SPECS.reviewer;
check(
  "the reviewer runs at medium effort for size S and keeps its effort for M and L",
  effortFor(reviewer, "S") === "medium" &&
    effortFor(reviewer, "M") === reviewer.effort &&
    effortFor(reviewer, "L") === reviewer.effort &&
    effortFor(reviewer, undefined) === reviewer.effort,
);
check(
  "other roles keep their effort at size S",
  effortFor(ROLE_SPECS.inspector, "S") === ROLE_SPECS.inspector.effort,
);
const reviewArgs = { ticket: "PURCO-1", base: "dev", pack: "/pack" };
check(
  "the size S review task reads the diff only and skips the ADR sweep",
  reviewTaskFor({ ...reviewArgs, size: "S" }).includes("git diff origin/dev...HEAD") &&
    reviewTaskFor({ ...reviewArgs, size: "S" }).includes("Do not sweep the ADRs"),
);
check(
  "the size M and L review task is unchanged",
  reviewTaskFor({ ...reviewArgs, size: "M" }) === reviewTaskFor({ ...reviewArgs, size: "L" }) &&
    !reviewTaskFor({ ...reviewArgs, size: "M" }).includes("git diff"),
);

section("harden mode and the plan gate");

const mapperOutcome = (overrides: Partial<PhaseOutcome>): PhaseOutcome => ({
  phase: "test",
  agent: "MAPPER-map",
  status: "escalated",
  summary: "no result",
  costUsd: 0,
  turns: 1,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  escalations: [],
  errors: [],
  ...overrides,
});
check(
  "a mapper with no handoff stops the plan",
  mapperFailure(mapperOutcome({ result: { status: "failed", summary: "no result", produced: [], openQuestions: 0 } }))?.includes("no accepted handoff") === true,
);
check("a mapper with no result stops the plan", mapperFailure(mapperOutcome({})) !== undefined);
check(
  "a delivered mapper lets the plan go on",
  mapperFailure(mapperOutcome({ status: "done", result: { status: "delivered", summary: "ok", produced: [], openQuestions: 0 } })) === undefined,
);

const hardenSource = "src/server/api/modules/claims/create-claim.usecase.ts";
const hardenFiles: Record<string, string> = {
  "src/server/api/tests/usecases/claims/create-claim.usecase.test.ts": `import { CreateClaimUseCase } from "~/server/api/modules/claims/create-claim.usecase"\nit("creates a claim", () => {})\ntest.each([1])("rejects a bad total", () => {})`,
  "src/server/api/tests/usecases/claims/other.usecase.test.ts": `import { X } from "~/server/api/modules/claims/other.usecase"\nit("other", () => {})`,
  "src/server/api/tests/helpers/create-claim.test.ts": `import { CreateClaimUseCase } from "../../modules/claims/create-claim.usecase"`,
  "src/server/api/tests/usecases/claims/relative.usecase.test.ts": `import { CreateClaimUseCase } from "../../../modules/claims/create-claim.usecase.ts"`,
  [hardenSource]: "export const a = 1",
};
const found = existingUnits({
  sources: [hardenSource],
  testFiles: Object.keys(hardenFiles),
  scope: "backend",
  read: (file) => hardenFiles[file] ?? "",
});
check(
  "existing usecase-level tests that import the changed file are found",
  found.map((unit) => unit.file).join("|") ===
    "src/server/api/tests/usecases/claims/create-claim.usecase.test.ts|src/server/api/tests/usecases/claims/relative.usecase.test.ts",
);
check(
  "a test outside the usecases folder is left out of backend harden",
  !found.some((unit) => unit.file.includes("helpers")),
);

const allTrue = { d1: true, d2: true, d3: true, d4: true, d5: true, d6: true, d7: false, d8: false, d9: false, d10: true };
check(
  "harden finishes DONE when D1 to D6 and D10 hold and D7 to D9 are false",
  (() => {
    const decision = exitDecision({ mode: "harden", predicates: allTrue, stalled: false, hasBlocker: false });
    return decision.exitKind === "DONE" && decision.failing.length === 0 && decision.notUsed.join(",") === "D7,D8,D9";
  })(),
);
check(
  "harden blocks on a failing counted predicate",
  (() => {
    const decision = exitDecision({ mode: "harden", predicates: { ...allTrue, d6: false }, stalled: false, hasBlocker: false });
    return decision.exitKind === "BLOCKED" && decision.failing.join(",") === "D6";
  })(),
);
check(
  "harden stalls when the vector stopped moving",
  exitDecision({ mode: "harden", predicates: { ...allTrue, d2: false }, stalled: true, hasBlocker: false }).exitKind === "STALLED",
);
check(
  "a blocker wins over a green harden vector",
  exitDecision({ mode: "harden", predicates: allTrue, stalled: false, hasBlocker: true }).exitKind === "BLOCKED",
);
check(
  "write mode still counts D7 to D9",
  (() => {
    const decision = exitDecision({ mode: "write", predicates: allTrue, stalled: false, hasBlocker: false });
    return decision.exitKind === "BLOCKED" && decision.failing.join(",") === "D7,D8,D9" && decision.notUsed.length === 0;
  })(),
);

const baselineFile = "src/server/api/tests/usecases/claims/create-claim.usecase.test.ts";
const baseline = baselineOf([baselineFile], (file) => hardenFiles[file] ?? "");
check(
  "the names of the existing tests are recorded",
  protectedTestsOf(baseline, baselineFile).join("|") === "creates a claim|rejects a bad total",
);
check("a file with a test removed reports it", (() => {
  const removed = removedProtectedTests(baseline, () => `it("creates a claim", () => {})`);
  return removed.length === 1 && removed[0]?.names.join("|") === "rejects a bad total";
})());
check(
  "a file that only gained tests reports no removal",
  removedProtectedTests(baseline, (file) => `${hardenFiles[file] ?? ""}\nit("kills the mutant", () => {})`).length === 0,
);
check(
  "only the files that changed are reported as changed",
  changedTestFiles(baseline, () => "other").length === 1 &&
    changedTestFiles(baseline, (file) => hardenFiles[file] ?? "").length === 0,
);
check("test names are read from it and test calls", testNames(`it('a', f)\ntest.skip("b", f)`).join("|") === "a|b");

const payload = planGatePayload({
  ticket: "PURCO-1",
  runId: 4,
  scope: "backend",
  mode: "write",
  depth: "full",
  size: "L",
  contract: "/c.md",
  units: [
    { file: "src/server/api/tests/usecases/a.test.ts", sources: ["a.ts"], rows: [{ matrixKey: "U1", rowKey: "R1" }], focusLines: [] },
    { file: "src/server/api/tests/helpers/b.test.ts", sources: [], rows: [], focusLines: [] },
  ],
  radius: { total: 694, unresolved: 664 },
  mapperDelivered: false,
});
check(
  "the plan gate payload carries every warning",
  payload.warnings.map((warning) => warning.code).sort().join("|") ===
    "focus-none|mapper-no-result|non-usecase-files|radius-unresolved-majority",
);
check(
  "the plan gate payload marks the test level by path",
  payload.units[0]?.usecaseLevel === true && payload.units[1]?.usecaseLevel === false && payload.units[0]?.rows === 1,
);

const payloadStore = new Store(path.join(tmp, "payload.sqlite"), "run-p");
payloadStore.askQuestion("G-1", "MAPPER", "test", "gate", "plan", payload);
payloadStore.askQuestion("Q-1", "AUTHOR", "test", "question", "plain");
const openItems = payloadStore.openHumanItems();
check(
  "the plan gate payload is stored and other items keep none",
  JSON.stringify(openItems.find((entry) => entry.id === "G-1")?.payload) === JSON.stringify(payload) &&
    openItems.find((entry) => entry.id === "Q-1")?.payload === null,
);
check(
  "an item answers once",
  payloadStore.answerQuestion("G-1", "approve", "dashboard") === true &&
    payloadStore.answerQuestion("G-1", "again", "dashboard") === false,
);
payloadStore.close();

section("the usage monitor");

const usageLine = (id: string, request: string, at: string, model = "claude-sonnet-5-5") =>
  JSON.stringify({
    type: "assistant",
    requestId: request,
    timestamp: at,
    message: {
      id,
      model,
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 1000 },
    },
  });
const parsedEntry = entryFromLine(usageLine("m1", "r1", "2026-10-07T10:20:00.000Z"));
check(
  "a usage line becomes an entry",
  parsedEntry?.key === "m1:r1" && parsedEntry.output === 20 && parsedEntry.cacheRead === 1000,
);
check("a line without usage is skipped", entryFromLine('{"type":"user"}') === undefined);
check("a synthetic model is skipped", entryFromLine(usageLine("m2", "r2", "2026-10-07T10:20:00.000Z", "<synthetic>")) === undefined);
const usageEntries = [
  entryFromLine(usageLine("m1", "r1", "2026-10-07T10:20:00.000Z")),
  entryFromLine(usageLine("m1", "r1", "2026-10-07T10:20:00.000Z")),
  entryFromLine(usageLine("m3", "r3", "2026-10-07T11:40:00.000Z")),
  entryFromLine(usageLine("m4", "r4", "2026-10-07T17:00:00.000Z", "claude-opus-5-5")),
].filter((entry): entry is UsageEntry => entry !== undefined);
check("an entry seen twice counts once", dedupe(usageEntries).length === 3);
const usageBlocks = blocksOf(dedupe(usageEntries));
check("a gap of five hours starts a new block", usageBlocks.length === 2 && usageBlocks[0]?.length === 2);
const usageNow = Date.parse("2026-10-07T18:00:00.000Z");
const usageSnapshot = summarize(usageEntries, usageNow, true);
check(
  "the active block starts at the hour of its first message and resets five hours later",
  usageSnapshot.block?.startedAt === "2026-10-07T17:00:00.000Z" &&
    usageSnapshot.block.endsAt === "2026-10-07T22:00:00.000Z" &&
    usageSnapshot.block.resetsInMs === 4 * 3600 * 1000,
);
check(
  "the week counts every deduplicated entry and prices each model",
  usageSnapshot.rolling.messages === 3 && usageSnapshot.models.length === 2 && usageSnapshot.rolling.costUsd > 0,
);
check(
  "a block that ended is not active",
  summarize(usageEntries, Date.parse("2026-10-08T03:00:00.000Z"), true).block === null,
);
check("the week has seven day bars", usageSnapshot.days.length === 7);

const goodInit = {
  mcp_servers: [{ name: "orch", status: "connected" }],
  tools: ["Read", "mcp__orch__handoff"],
};
check("a connected orch server with handoff passes", orchestratorToolsProblem(goodInit) === undefined);
check(
  "a failed orch server is named by its status",
  orchestratorToolsProblem({ ...goodInit, mcp_servers: [{ name: "orch", status: "failed" }] }) === "failed",
);
check(
  "a missing orch server is reported",
  orchestratorToolsProblem({ ...goodInit, mcp_servers: [{ name: "test-forge", status: "connected" }] }) === "not registered",
);
check(
  "a connected orch server without the handoff tool is refused",
  orchestratorToolsProblem({ ...goodInit, tools: ["Read"] }) === "connected but no handoff tool",
);

section("monitor guard: host, origin and token");
const guardPort = 4317;
const guardToken = "a".repeat(64);
const goodPost: GuardInput = {
  method: "POST",
  host: "127.0.0.1:4317",
  origin: undefined,
  contentType: "application/json",
  token: guardToken,
};
check("the loopback host with the port is allowed", isAllowedHost("127.0.0.1:4317", guardPort));
check("localhost with the port is allowed", isAllowedHost("localhost:4317", guardPort));
check("another host is refused", !isAllowedHost("evil.example:4317", guardPort));
check("a rebound host with the right port is refused", !isAllowedHost("evil.example", guardPort));
check("a missing host is refused", !isAllowedHost(undefined, guardPort));
check("the loopback host with another port is refused", !isAllowedHost("127.0.0.1:9999", guardPort));
check("no origin is allowed", isAllowedOrigin(undefined, guardPort));
check("the loopback origin is allowed", isAllowedOrigin("http://127.0.0.1:4317", guardPort));
check("the localhost origin is allowed", isAllowedOrigin("http://localhost:4317", guardPort));
check("a foreign origin is refused", !isAllowedOrigin("http://evil.example", guardPort));
check("a null origin is refused", !isAllowedOrigin("null", guardPort));
check("json content is accepted with a charset", isJsonContent("application/json; charset=utf-8"));
check("form content is refused", !isJsonContent("application/x-www-form-urlencoded"));
check("text content is refused", !isJsonContent("text/plain"));
check("a missing content type is refused", !isJsonContent(undefined));
check("the right token is accepted", isValidToken(guardToken, guardToken));
check("a wrong token is refused", !isValidToken("b".repeat(64), guardToken));
check("a short token is refused", !isValidToken("a", guardToken));
check("a missing token is refused", !isValidToken(undefined, guardToken));
check("a complete post passes", checkRequest(goodPost, guardPort, guardToken) === "ok");
check("a post from the same origin passes", checkRequest({ ...goodPost, origin: "http://localhost:4317" }, guardPort, guardToken) === "ok");
check("a get needs no token", checkRequest({ ...goodPost, method: "GET", token: undefined, contentType: undefined }, guardPort, guardToken) === "ok");
check("a get with a wrong host is refused", checkRequest({ ...goodPost, method: "GET", host: "evil.example" }, guardPort, guardToken) === "bad-host");
check("a post with a wrong host is refused", checkRequest({ ...goodPost, host: "evil.example:4317" }, guardPort, guardToken) === "bad-host");
check("a post from a foreign origin is refused", checkRequest({ ...goodPost, origin: "http://evil.example" }, guardPort, guardToken) === "bad-origin");
check("a post without a token is refused", checkRequest({ ...goodPost, token: undefined }, guardPort, guardToken) === "bad-token");
check("a post with a wrong token is refused", checkRequest({ ...goodPost, token: "b".repeat(64) }, guardPort, guardToken) === "bad-token");
check("a post without json content is refused", checkRequest({ ...goodPost, contentType: "text/plain" }, guardPort, guardToken) === "bad-content-type");
check("the token is placed in the page head", injectToken("<head></head>", "abc") === '<head><meta name="purco-token" content="abc" /></head>');

const stateStep = (status: PipelineStep["status"], index: number): PipelineStep => ({
  key: `step-${index}`,
  baseKey: `step-${index}`,
  attempt: 1,
  status,
});
const stateOf = (statuses: PipelineStep["status"][], alive: boolean): string =>
  deriveTicketState({ steps: statuses.map(stateStep), live: [], alive, nowMs: 0 });
check("a halted step alone gives halted", stateOf(["done", "halted"], false) === "halted");
check("a failed step alone gives failed", stateOf(["done", "failed"], false) === "failed");
check("halted and failed together give halted", stateOf(["failed", "halted"], false) === "halted");
check("halted with a live run and nothing running gives halted", stateOf(["done", "halted"], true) === "halted");
check("a failed step while another step runs gives running", stateOf(["failed", "running"], true) === "running");
check("all steps done gives done", stateOf(["done", "skipped"], false) === "done");
check("pending steps with no run give idle", stateOf(["done", "pending"], false) === "idle");

store.close();
pipelineStore.close();
gateDb.close();
fs.rmSync(tmp, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
