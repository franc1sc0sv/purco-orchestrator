import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "spike-cli.ts");

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-hub-"));
const dbPath = path.join(runDir, "orchestrator.sqlite");
const runId = "hub-test-1";
const ticket = "PURCO-0000";

let passed = 0;
let failed = 0;

const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) {
    passed += 1;
    process.stdout.write(`  PASS  ${label}\n`);
    return;
  }
  failed += 1;
  process.stdout.write(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}\n`);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const runCli = (args: string[]): Promise<string> =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", cli, ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("close", () => resolve(out));
  });

const lines: string[] = [];
const watcher = spawn(
  process.execPath,
  [
    "--experimental-strip-types",
    "--no-warnings",
    cli,
    "watch",
    "--db",
    dbPath,
    "--run",
    runId,
    "--interval",
    "1",
    "--max-idle",
    "30",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let watcherEnded = false;
watcher.stdout.on("data", (chunk: Buffer) => {
  for (const line of chunk.toString().split("\n")) {
    if (line.trim().length > 0) lines.push(line.trim());
  }
});
watcher.on("close", () => {
  watcherEnded = true;
});

const store = new Store(dbPath, runId);
const beat = 1600;

process.stdout.write(`hub signals — ${dbPath}\n\n`);

await sleep(beat);
store.startRun(ticket);
store.startPhase("intake", "INTAKE-1");
await sleep(beat);
check(
  "watch reports a phase as running",
  lines.some((line) => line === "PHASE intake running | INTAKE-1"),
  lines.join(" / "),
);

store.askQuestion(
  "Q-hub-1",
  "INTAKE-1",
  "intake",
  "human",
  "Is the flag additive or a replacement?",
);
await sleep(beat);
const questionLine = lines.find((line) => line.startsWith("QUESTION "));
check("watch reports the question", questionLine !== undefined);
check(
  "the question line carries the agent and the phase",
  questionLine?.includes("| INTAKE-1 | intake |") === true,
  questionLine ?? "no line",
);
check(
  "the question is open until it is answered",
  store.openQuestions().length === 1,
);

store.askQuestion(
  "G-hub-1",
  "LEAD",
  "intake",
  "gate",
  "Intake is done. Approve to start the grill.",
);
await sleep(beat);
check(
  "watch reports a gate as a GATE line",
  lines.some((line) => line.startsWith("GATE G-hub-1 | LEAD | intake |")),
  lines.join(" / "),
);
store.answerQuestion("G-hub-1", "approve", "human");

const answered = await runCli([
  "answer",
  "--db",
  dbPath,
  "--run",
  runId,
  "--id",
  "Q-hub-1",
  "--text",
  "Additive. Keep the old path.",
]);
check(
  "answer confirms and reports none still open",
  answered.includes("0 question(s) still open"),
);
check(
  "the asking agent reads the exact answer",
  store.answerFor("Q-hub-1") === "Additive. Keep the old path.",
  store.answerFor("Q-hub-1") ?? "undefined",
);

store.endPhase({
  phase: "intake",
  status: "done",
  summary: "Read the ticket and wrote 01-ticket-and-context.md",
  costUsd: 0.42,
  turns: 7,
  tokensIn: 12000,
  tokensOut: 900,
  tokensCacheRead: 40000,
  tokensCacheWrite: 3000,
  model: "claude-sonnet-5-5",
});
await sleep(beat);
check(
  "watch reports the phase closing",
  lines.some((line) => line.startsWith("PHASE intake done | INTAKE-1 |")),
  lines.join(" / "),
);

store.startPhase("plan", "PLANNER-1");
await sleep(beat);
check(
  "watch reports the next phase",
  lines.some((line) => line === "PHASE plan running | PLANNER-1"),
);

store.endPhase({
  phase: "plan",
  status: "escalated",
  summary: "Blocked on the base branch",
  costUsd: 0.1,
  turns: 2,
  tokensIn: 3000,
  tokensOut: 200,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  model: "claude-opus-5-5",
});
store.endRun("complete");
await sleep(beat * 2);
check(
  "watch reports the end of the run",
  lines.some((line) => line.startsWith("RUN_END complete")),
  lines.join(" / "),
);
check("watch exits after the run ends", watcherEnded);

const status = await runCli(["status", "--db", dbPath, "--run", runId]);
check("status prints a phase table", status.includes("PHASES"));
check(
  "status prints every phase",
  status.includes("intake") && status.includes("plan"),
);
check("status prints the phase status", status.includes("escalated"));
check(
  "status prints the phase summary",
  status.includes("Blocked on the base branch"),
);
check("status prints the answered question", status.includes("answered"));

const phases = store.phases();
check(
  "the store keeps one row per phase",
  phases.length === 2,
  String(phases.length),
);
check(
  "the phase row keeps its cost and its turns",
  phases[0]?.costUsd === 0.42 && phases[0]?.turns === 7,
  JSON.stringify(phases[0]),
);
check(
  "the run row is closed",
  store.runStatus()?.status === "complete" &&
    Boolean(store.runStatus()?.endedAt),
);

const second: string[] = [];
const watcher2 = spawn(
  process.execPath,
  [
    "--experimental-strip-types",
    "--no-warnings",
    cli,
    "watch",
    "--db",
    dbPath,
    "--run",
    runId,
    "--interval",
    "1",
    "--max-idle",
    "30",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let secondEnded = false;
watcher2.stdout.on("data", (chunk: Buffer) => {
  for (const line of chunk.toString().split("\n")) {
    if (line.trim().length > 0) second.push(line.trim());
  }
});
watcher2.on("close", () => {
  secondEnded = true;
});

await sleep(beat);
store.startRun(ticket);
check(
  "a second segment reopens the run",
  store.runStatus()?.status === "running" && !store.runStatus()?.endedAt,
  JSON.stringify(store.runStatus()),
);

store.startPhase("build", "BUILDER-1");
await sleep(beat * 2);
check(
  "the second watch reports the new phase",
  second.some((line) => line === "PHASE build running | BUILDER-1"),
  second.join(" / "),
);
check(
  "the second watch does not replay finished phases",
  !second.some((line) => line.startsWith("PHASE intake")),
  second.join(" / "),
);
check(
  "the second watch does not end while the run is open",
  !second.some((line) => line.startsWith("RUN_END")),
);

store.endPhase({
  phase: "build",
  status: "done",
  summary: "Built the slice",
  costUsd: 1.2,
  turns: 40,
  tokensIn: 80000,
  tokensOut: 12000,
  tokensCacheRead: 200000,
  tokensCacheWrite: 15000,
  model: "claude-opus-5-5",
});
store.endRun("complete");
await sleep(beat * 2);
check(
  "the second segment ends the run again",
  second.some((line) => line.startsWith("RUN_END complete")) && secondEnded,
  second.join(" / "),
);

store.close();
if (!watcherEnded) watcher.kill();
if (!secondEnded) watcher2.kill();
fs.rmSync(runDir, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
