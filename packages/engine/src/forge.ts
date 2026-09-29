import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  runOperation,
  type HumanKind,
  type OperationResult,
} from "test-forge-runner/src/application/run-operation.ts";
import { state } from "test-forge-mcp-server/src/application/ledger/state.ts";

export type ForgeScope = "backend" | "frontend";

export type ForgeDefect = {
  findingKey: string;
  title: string;
};

export type ForgeInput = {
  worktree: string;
  pack: string;
  runDir: string;
  ticket: string;
  base: string;
  scope?: ForgeScope;
  targets?: string;
  focus?: string;
  fresh: boolean;
  askHuman: (kind: HumanKind, text: string) => Promise<string | undefined>;
  orchServer: McpServerConfig;
  orchTools: string[];
  env: Record<string, string | undefined>;
};

export type ForgeOutcome = {
  result: OperationResult;
  scope: ForgeScope;
  targets: string[];
  defects: ForgeDefect[];
  logFile: string;
};

const RUN_FILE = "forge-run.json";

const SOURCE = /\.(ts|tsx)$/;
const TEST = /([.\-_](test|spec)\.[cm]?[jt]sx?$)|(^|\/)(tests?|__tests__|e2e|fixtures)\//;

const git = (worktree: string, args: string[]): string[] => {
  try {
    return execFileSync("git", args, {
      cwd: worktree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

export const changedProductionFiles = (worktree: string, base: string): string[] =>
  [
    ...new Set([
      ...git(worktree, ["diff", "--name-only", `origin/${base}`]),
      ...git(worktree, ["ls-files", "--others", "--exclude-standard"]),
    ]),
  ]
    .filter((file) => SOURCE.test(file) && !TEST.test(file))
    .sort();

export const scopeFor = (files: string[]): ForgeScope =>
  files.length === 0 || files.some((file) => file.startsWith("src/server/"))
    ? "backend"
    : "frontend";

export const testSurface = (pack: string): string | undefined => {
  const file = path.join(pack, "02-plan.md");
  if (!fs.existsSync(file)) return undefined;
  const plan = fs.readFileSync(file, "utf8");
  const match = /\*\*Test surface\*\*[:\s—-]*([\s\S]*?)(?=\n\s*-\s*\*\*|\n#|$)/.exec(plan);
  const surface = match?.[1]
    ?.split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
  return surface || undefined;
};

const storedRunId = (pack: string): number | null => {
  const file = path.join(pack, RUN_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const value = (JSON.parse(fs.readFileSync(file, "utf8")) as { runId?: unknown }).runId;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
};

const confirmedDefects = async (cwd: string, runId: number): Promise<ForgeDefect[]> => {
  const snapshot = await state({ cwd, runId });
  return snapshot.findings
    .filter((finding) => finding.status === "confirmed-defect")
    .map((finding) => ({ findingKey: finding.findingKey, title: finding.title }));
};

export const runForge = async (input: ForgeInput): Promise<ForgeOutcome> => {
  const targets = changedProductionFiles(input.worktree, input.base);
  const scope = input.scope ?? scopeFor(targets);
  const logFile = path.join(input.runDir, "forge.log");
  const log = (line: string): void => {
    fs.appendFileSync(logFile, `${line}\n`);
  };

  const focus =
    input.focus ??
    testSurface(input.pack) ??
    (await input.askHuman(
      "question",
      `The test operation for ${input.ticket} needs its focus: what must it prove? Write one line per thing. The plan has no "Test surface" section to take it from.`,
    ));
  if (!focus) {
    const reason = "The test operation has no focus, so it cannot open a run.";
    log(reason);
    return {
      result: { code: 3, runId: null, exit: null, costUsd: 0, refusal: reason },
      scope,
      targets,
      defects: [],
      logFile,
    };
  }

  const previous = input.fresh ? null : storedRunId(input.pack);
  const result = await runOperation({
    cwd: input.worktree,
    scope,
    focus,
    operation: input.targets ?? `Cover the change on this branch for ${input.ticket}.`,
    targets: input.targets ? [input.targets] : targets,
    runId: previous,
    openNew: previous === null,
    approvePlan: false,
    host: {
      line: log,
      askHuman: input.askHuman,
      mcpServers: { orch: input.orchServer },
      allowedTools: input.orchTools,
      env: input.env,
    },
  });

  if (result.runId !== null) {
    fs.writeFileSync(
      path.join(input.pack, RUN_FILE),
      JSON.stringify({ runId: result.runId, scope, at: new Date().toISOString() }, null, 2),
    );
  }

  const defects =
    result.runId !== null ? await confirmedDefects(input.worktree, result.runId) : [];
  return { result, scope, targets, defects, logFile };
};
