import { spawn } from "node:child_process";

export const DEFAULT_TIMEOUT_MS = 600_000;
export const DEFAULT_SUITE_TIMEOUT_MS = 900_000;
export const MAX_TIMEOUT_MS = 3_600_000;
export const MAX_CAPTURE_BYTES = 4_000_000;

const SIGKILL_GRACE_MS = 5_000;

export type ProcessResult = {
  command: string;
  cwd: string;
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  timeoutMs: number;
  spawnError: string | null;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
};

export type ProcessOptions = {
  command: string;
  args?: readonly string[];
  cwd: string;
  shell?: boolean;
  timeoutMs?: number | undefined;
  defaultTimeoutMs?: number | undefined;
  env?: Readonly<Record<string, string>> | undefined;
};

export const boundedTimeout = (
  value: number | undefined,
  fallback: number,
): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.trunc(numeric), MAX_TIMEOUT_MS);
};

const environment = (
  extra: Readonly<Record<string, string>> | undefined,
): Record<string, string | undefined> => ({ ...process.env, ...extra });

const liveGroups = new Set<number>();

const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    liveGroups.delete(pid);
  }
};

process.on("exit", () => {
  for (const pid of liveGroups) signalGroup(pid, "SIGKILL");
});

export const runProcess = ({
  command,
  args = [],
  cwd,
  shell = false,
  timeoutMs,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  env,
}: ProcessOptions): Promise<ProcessResult> =>
  new Promise((settle) => {
    const limit = boundedTimeout(timeoutMs, defaultTimeoutMs);
    const startedAt = Date.now();
    const child = spawn(command, [...args], {
      cwd,
      shell,
      env: environment(env),
      detached: true,
    });
    const group = child.pid;
    if (group !== undefined) liveGroups.add(group);

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const collectOut = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (stdoutBytes < MAX_CAPTURE_BYTES) stdout += text;
      stdoutBytes += Buffer.byteLength(text);
    };

    const collectErr = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (stderrBytes < MAX_CAPTURE_BYTES) stderr += text;
      stderrBytes += Buffer.byteLength(text);
    };

    child.stdout?.on("data", collectOut);
    child.stderr?.on("data", collectErr);

    const timer = setTimeout(() => {
      timedOut = true;
      if (group === undefined) return;
      signalGroup(group, "SIGTERM");
      killTimer = setTimeout(() => signalGroup(group, "SIGKILL"), SIGKILL_GRACE_MS);
    }, limit);

    const finish = (
      code: number | null,
      signal: string | null,
      spawnError: Error | null,
    ): void => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (group !== undefined) liveGroups.delete(group);
      settle({
        command,
        cwd,
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        timeoutMs: limit,
        spawnError: spawnError ? spawnError.message : null,
        stdoutTruncated: stdoutBytes > MAX_CAPTURE_BYTES,
        stderrTruncated: stderrBytes > MAX_CAPTURE_BYTES,
        durationMs: Date.now() - startedAt,
      });
    };

    child.on("error", (error) => finish(null, null, error));
    child.on("close", (code, signal) => finish(code, signal, null));
  });
