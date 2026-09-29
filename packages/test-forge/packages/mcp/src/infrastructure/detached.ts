import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

export type DetachedStart =
  { ok: true; pid: number } | { ok: false; reason: string };

export const spawnDetached = ({
  command,
  args,
  cwd,
  logPath,
  env,
}: {
  command: string;
  args: readonly string[];
  cwd: string;
  logPath: string;
  env?: Readonly<Record<string, string>>;
}): DetachedStart => {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const log = openSync(logPath, "a");
    const child = spawn(command, [...args], {
      cwd,
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, ...env },
    });
    child.unref();
    if (child.pid === undefined) {
      return { ok: false, reason: "the boot process reported no pid" };
    }
    return { ok: true, pid: child.pid };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};

export const processAlive = (pid: number | null): boolean => {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const signalProcess = (pid: number | null, signal: string): boolean => {
  if (pid === null) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((settle) => {
    setTimeout(settle, ms);
  });

export const waitFor = async (
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 500,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
};
