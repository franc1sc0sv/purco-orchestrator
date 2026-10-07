import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ResultFinding, StepResult } from "./types.ts";

export const FLOW_CONFIG = "tests/e2e/flows/recording.config.ts";
export const STAGING_DIR = "tests/e2e/flows/recording-run";
export const FLOW_TIMEOUT_MS = 180_000;
export const MISSING_LIBRARY_REASON = "flow library missing in the worktree";
export const NO_FLOWS_REASON = "verify wrote no recording scripts";
export const MANIFEST_FILE = path.join("verify", "flows", "flows.json");

const ERROR_TAIL_CHARS = 800;
const OUTPUT_BUFFER_CHARS = 8_000;
const ANSI = /\u001b\[[0-9;]*m/g;

export const FLAG_STATES = ["ON", "OFF", "NONE"] as const;

export type FlagState = (typeof FLAG_STATES)[number];

const ManifestSchema = z.array(
  z.object({
    file: z.string().regex(/^[\w.-]+\.spec\.ts$/),
    criterion: z.string().min(1),
    flagState: z.enum(FLAG_STATES),
  }),
);

export type FlowEntry = z.infer<typeof ManifestSchema>[number];

export type ManifestParse =
  | { ok: true; entries: FlowEntry[] }
  | { ok: false; error: string };

const FLAG_SUFFIX: Record<FlagState, string> = {
  ON: "-flag-on",
  OFF: "-flag-off",
  NONE: "",
};

export const videoFileName = (entry: FlowEntry): string => {
  const stem = path
    .basename(entry.file)
    .replace(/\.spec\.ts$/, "")
    .replace(/-flag-(on|off)$/, "");
  return `${stem}${FLAG_SUFFIX[entry.flagState]}.webm`;
};

export const parseFlowManifest = (text: string): ManifestParse => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `flows.json is not valid JSON: ${String(error)}` };
  }
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "flows.json"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `flows.json is malformed (${issues})` };
  }
  const names = parsed.data.map(videoFileName);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) {
    return { ok: false, error: `flows.json maps two flows to the video ${duplicate}` };
  }
  return { ok: true, entries: parsed.data };
};

export const recordSkipReason = (
  worktree: string,
  pack: string,
): string | undefined => {
  if (!fs.existsSync(path.join(worktree, FLOW_CONFIG))) return MISSING_LIBRARY_REASON;
  const manifestFile = path.join(pack, MANIFEST_FILE);
  if (!fs.existsSync(manifestFile)) return NO_FLOWS_REASON;
  const manifest = parseFlowManifest(fs.readFileSync(manifestFile, "utf8"));
  return manifest.ok && manifest.entries.length === 0 ? NO_FLOWS_REASON : undefined;
};

export type PlaywrightCommand = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
};

export const buildPlaywrightCommand = (input: {
  worktree: string;
  script: string;
  outputDir: string;
  tenant: string;
}): PlaywrightCommand => ({
  command: "npx",
  args: [
    "playwright",
    "test",
    input.script,
    "-c",
    FLOW_CONFIG,
    "--output",
    input.outputDir,
  ],
  cwd: input.worktree,
  env: { TENANT: input.tenant, envmode: "local" },
  timeoutMs: FLOW_TIMEOUT_MS,
});

export type Execution = { ok: boolean; tail: string };

export type Execute = (command: PlaywrightCommand) => Promise<Execution>;

const tailOf = (output: string): string =>
  output.replace(ANSI, "").trim().slice(-ERROR_TAIL_CHARS);

export const executeCommand: Execute = (command) =>
  new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_BUFFER_CHARS);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        child.kill("SIGKILL");
      }
    }, command.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, tail: tailOf(String(error)) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const tail = tailOf(output);
      resolve(
        timedOut
          ? {
              ok: false,
              tail: `timed out after ${command.timeoutMs / 1000}s\n${tail}`.slice(
                -ERROR_TAIL_CHARS,
              ),
            }
          : { ok: code === 0, tail },
      );
    });
  });

export type FlowRun = {
  entry: FlowEntry;
  status: "passed" | "failed";
  video?: string;
  error?: string;
};

const findVideo = (dir: string): string | undefined => {
  if (!fs.existsSync(dir)) return undefined;
  const found = fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .find((name) => name.endsWith(".webm"));
  return found ? path.join(dir, found) : undefined;
};

const stageScript = (worktree: string, source: string): string => {
  const stagedDir = path.join(worktree, STAGING_DIR);
  fs.mkdirSync(stagedDir, { recursive: true });
  const staged = path.join(stagedDir, path.basename(source));
  fs.copyFileSync(source, staged);
  return path.relative(worktree, staged);
};

const recordFlow = async (input: {
  entry: FlowEntry;
  worktree: string;
  pack: string;
  videosDir: string;
  tenant: string;
  execute: Execute;
}): Promise<FlowRun> => {
  const { entry, worktree, pack, videosDir, tenant, execute } = input;
  const source = path.join(pack, "verify", "flows", entry.file);
  if (!fs.existsSync(source)) {
    return { entry, status: "failed", error: `${source} does not exist` };
  }
  const videoName = videoFileName(entry);
  const scratch = path.join(videosDir, `.run-${videoName}`);
  const script = stageScript(worktree, source);
  try {
    const run = await execute(
      buildPlaywrightCommand({ worktree, script, outputDir: scratch, tenant }),
    );
    if (!run.ok) return { entry, status: "failed", error: run.tail };
    const produced = findVideo(scratch);
    if (!produced) {
      return { entry, status: "failed", error: "the script passed but wrote no video" };
    }
    const video = path.join(videosDir, videoName);
    fs.renameSync(produced, video);
    return { entry, status: "passed", video };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(path.join(worktree, script), { force: true });
    fs.rmSync(path.join(worktree, STAGING_DIR), { recursive: true, force: true });
  }
};

export const buildRecordResult = (runs: FlowRun[], total: number): StepResult => {
  const failed = runs.filter((run) => run.status === "failed");
  const videos = runs.flatMap((run) => (run.video ? [run.video] : []));
  const findings: ResultFinding[] = failed.map((run) => ({
    title: `${run.entry.file} failed: ${run.entry.criterion}`,
    severity: "high",
    location: run.error ?? "no error output",
  }));
  const finished = runs.length === total;
  const status =
    failed.length > 0 ? "failed" : finished ? "delivered" : "blocked";
  const summary =
    failed.length > 0
      ? `${failed.length} of ${total} recording scripts failed: ${failed.map((run) => run.entry.file).join(", ")}`
      : finished
        ? `${videos.length} videos recorded for ${total} flows`
        : `${runs.length} of ${total} flows recorded so far`;
  return {
    status,
    summary,
    produced: videos,
    openQuestions: 0,
    evidence: status === "delivered" ? undefined : summary,
    counts: { flows: total, videos: videos.length, failed: failed.length },
    findings: findings.length > 0 ? findings : undefined,
  };
};

export type RecordOutcome = {
  status: "done" | "failed";
  summary: string;
  result?: StepResult;
};

export const recordFlows = async (input: {
  worktree: string;
  pack: string;
  tenant: string;
  execute?: Execute;
  onProgress?: (runs: FlowRun[], total: number, next?: FlowEntry) => void;
}): Promise<RecordOutcome> => {
  const manifest = parseFlowManifest(
    fs.readFileSync(path.join(input.pack, MANIFEST_FILE), "utf8"),
  );
  if (!manifest.ok) return { status: "failed", summary: manifest.error };

  const videosDir = path.join(input.pack, "verify", "videos");
  fs.mkdirSync(videosDir, { recursive: true });
  const runs: FlowRun[] = [];
  const total = manifest.entries.length;
  for (const entry of manifest.entries) {
    input.onProgress?.(runs, total, entry);
    runs.push(
      await recordFlow({
        entry,
        worktree: input.worktree,
        pack: input.pack,
        videosDir,
        tenant: input.tenant,
        execute: input.execute ?? executeCommand,
      }),
    );
  }
  input.onProgress?.(runs, total);
  const result = buildRecordResult(runs, total);
  return {
    status: result.status === "delivered" ? "done" : "failed",
    summary: result.summary,
    result,
  };
};
