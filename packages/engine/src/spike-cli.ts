import fs from "node:fs";
import path from "node:path";
import { GAF } from "./dashboard-data.ts";
import { noteLabel } from "./notes.ts";
import { Store } from "./store.ts";
import type { StoredPhase } from "./types.ts";

const usage = `usage: purco-spike <command> --db <file> --run <id> [options]

  watch      stream one line per new open question, plus RUN_END; for Monitor
  questions  print the open questions and exit
  answer     --id <question id> --text "<answer>"
  status     phases, sites, findings and open questions

usage: purco-spike note <TICKET> [--agent <label>] [--file <path> --line <n>] "<text>"
`;

const parse = (): { command: string; args: Record<string, string> } => {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "";
  const args: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} needs a value\n\n${usage}`);
    }
    args[token.slice(2)] = value;
    index += 1;
  }
  if (!command) throw new Error(usage);
  if (!args.db || !args.run)
    throw new Error(`--db and --run are required\n\n${usage}`);
  args.db = path.resolve(args.db);
  return { command, args };
};

const oneLine = (text: string, max = 220): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

const lineKind = (level: string): string =>
  level === "gate" ? "GATE" : level === "sign" ? "SIGN" : "QUESTION";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const openStore = (args: Record<string, string>): Store =>
  new Store(args.db ?? "", args.run ?? "");

const cmdQuestions = (args: Record<string, string>): void => {
  const store = openStore(args);
  const open = store.openQuestions();
  if (open.length === 0) {
    process.stdout.write("No open questions.\n");
  } else {
    for (const question of open) {
      process.stdout.write(
        `${lineKind(question.level)} ${question.id}  from ${question.fromAgent}  phase ${question.phase}\n${question.question}\n\n`,
      );
    }
  }
  store.close();
};

const cmdAnswer = (args: Record<string, string>): void => {
  if (!args.id || !args.text) {
    throw new Error(`answer needs --id and --text\n\n${usage}`);
  }
  const store = openStore(args);
  const before = store.openQuestions().some((q) => q.id === args.id);
  if (!before) {
    store.close();
    process.stdout.write(
      `No open question with id ${args.id}. It may already be answered.\n`,
    );
    process.exitCode = 1;
    return;
  }
  store.answerQuestion(args.id, args.text, "human");
  const stillOpen = store.openQuestions().length;
  store.close();
  process.stdout.write(
    `Answered ${args.id}. ${stillOpen} question(s) still open.\n`,
  );
};

const phaseLines = (phases: StoredPhase[]): string[] => {
  if (phases.length === 0) return [];
  const lines = ["PHASES"];
  for (const phase of phases) {
    const cost = phase.costUsd ? ` $${phase.costUsd.toFixed(4)}` : "";
    lines.push(
      `  ${phase.phase.padEnd(12)}${phase.status.padEnd(12)}${phase.agent ?? ""}${cost}`,
    );
    if (phase.summary) lines.push(`      ${oneLine(phase.summary, 160)}`);
  }
  lines.push("");
  return lines;
};

const cmdStatus = (args: Record<string, string>): void => {
  const store = openStore(args);
  const phases = store.phases();
  const counts = store.siteCounts();
  const untriaged = store.untriagedSites().length;
  const clusters = store.clustersWithWork();
  const open = store.openQuestions();
  const answered = store.answeredQuestions();
  const awaiting = store.findingsAwaitingVerdict();
  const verified = store.findings("verified").length;
  const rejected = store.findings("rejected").length;
  const needsHuman = store.findings("needs_human").length;
  store.close();

  const lines = [
    `run ${args.run}`,
    "",
    ...phaseLines(phases),
    "SITES",
    ...Object.entries(counts).map(([key, n]) => `  ${key.padEnd(16)}${n}`),
    `  ${"untriaged total".padEnd(16)}${untriaged}`,
    `  ${"clusters left".padEnd(16)}${clusters.length}`,
    "",
    "FINDINGS",
    `  ${"awaiting verdict".padEnd(16)}${awaiting}`,
    `  ${"verified".padEnd(16)}${verified}`,
    `  ${"rejected".padEnd(16)}${rejected}`,
    `  ${"needs human".padEnd(16)}${needsHuman}`,
    "",
    "QUESTIONS",
    `  ${"open".padEnd(16)}${open.length}`,
    `  ${"answered".padEnd(16)}${answered.length}`,
  ];
  if (open.length > 0) {
    lines.push("", "OPEN NOW");
    for (const question of open) {
      lines.push(`  ${question.id}  ${oneLine(question.question, 140)}`);
    }
  }
  if (clusters.length > 0) {
    lines.push("", "NEXT CLUSTERS BY WRITER DENSITY");
    for (const cluster of clusters.slice(0, 5)) {
      lines.push(
        `  ${String(cluster.rows).padStart(3)} rows ${String(cluster.writers).padStart(3)} writers  ${cluster.cluster}`,
      );
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
};

const cmdWatch = async (args: Record<string, string>): Promise<void> => {
  const intervalMs = Number(args.interval ?? "5") * 1000;
  const seen = new Set<string>();
  const phaseState = new Map<string, string>();
  let lastEndedAt: string | undefined;
  let seeded = false;
  let idleTicks = 0;
  const maxIdle = Number(args["max-idle"] ?? "0");

  for (;;) {
    let ended = false;
    try {
      const store = openStore(args);
      for (const question of store.openQuestions()) {
        if (seen.has(question.id)) continue;
        seen.add(question.id);
        process.stdout.write(
          `${lineKind(question.level)} ${question.id} | ${question.fromAgent} | ${question.phase} | ${oneLine(question.question)}\n`,
        );
        idleTicks = 0;
      }
      for (const phase of store.phases()) {
        if (phaseState.get(phase.phase) === phase.status) continue;
        phaseState.set(phase.phase, phase.status);
        if (!seeded) continue;
        const detail = phase.summary ? ` | ${oneLine(phase.summary, 160)}` : "";
        process.stdout.write(
          `PHASE ${phase.phase} ${phase.status} | ${phase.agent ?? "-"}${detail}\n`,
        );
        idleTicks = 0;
      }
      const untriaged = store.untriagedSites().length;
      const awaiting = store.findingsAwaitingVerdict();
      const run = store.runStatus();
      store.close();

      if (run?.endedAt && !seeded) {
        lastEndedAt = run.endedAt;
      } else if (run?.endedAt && run.endedAt !== lastEndedAt) {
        lastEndedAt = run.endedAt;
        process.stdout.write(
          `RUN_END ${run.status} | untriaged ${untriaged} | findings awaiting verdict ${awaiting}\n`,
        );
        ended = true;
      }
      seeded = true;
    } catch (error) {
      process.stdout.write(`WATCH_ERROR ${oneLine(String(error))}\n`);
    }

    if (ended) return;
    idleTicks += 1;
    if (maxIdle > 0 && idleTicks >= maxIdle) {
      process.stdout.write("WATCH_IDLE no activity within the idle budget\n");
      return;
    }
    await sleep(intervalMs);
  }
};

const cmdNote = (): void => {
  const rest = process.argv.slice(3);
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? "";
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const value = rest[index + 1];
    if (!value) throw new Error(`${token} needs a value\n\n${usage}`);
    flags[token.slice(2)] = value;
    index += 1;
  }
  const [ticket, ...words] = positional;
  const text = words.join(" ").trim();
  if (!ticket || !text) throw new Error(`note needs a ticket and a text\n\n${usage}`);
  const line = flags.line === undefined ? undefined : Number(flags.line);
  if (line !== undefined && (!Number.isInteger(line) || line < 1)) {
    throw new Error(`--line must be a positive integer\n\n${usage}`);
  }
  const dbPath = path.join(GAF, ticket, "orchestrator.sqlite");
  if (!fs.existsSync(dbPath)) throw new Error(`No orchestrator store for ${ticket} in ${GAF}`);
  const store = new Store(dbPath, "");
  store.bindTicket(ticket);
  const id = store.addNote({
    text,
    via: "cli",
    ...(flags.agent ? { targetAgent: flags.agent } : {}),
    ...(flags.file ? { file: flags.file } : {}),
    ...(line === undefined ? {} : { line }),
  });
  store.close();
  process.stdout.write(`Queued ${noteLabel(id)} for ${ticket}.\n`);
};

const main = async (): Promise<void> => {
  if (process.argv[2] === "note") return cmdNote();
  const { command, args } = parse();
  if (command === "questions") return cmdQuestions(args);
  if (command === "answer") return cmdAnswer(args);
  if (command === "status") return cmdStatus(args);
  if (command === "watch") return cmdWatch(args);
  throw new Error(`unknown command ${command}\n\n${usage}`);
};

await main();
