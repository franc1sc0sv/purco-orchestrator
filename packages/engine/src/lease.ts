import os from "node:os";
import type { LeaseRow, Store } from "./store.ts";

export const HEARTBEAT_MS = 5_000;
export const STALE_AFTER_MS = 60_000;

export type LeaseContext = {
  now: number;
  host: string;
  alive: (pid: number) => boolean;
};

const shutdownTasks = new Set<() => Promise<unknown>>();

export const onShutdown = (task: () => Promise<unknown>): (() => void) => {
  shutdownTasks.add(task);
  return () => shutdownTasks.delete(task);
};

const exitAfterShutdown = (code: number): void => {
  void Promise.allSettled([...shutdownTasks].map((task) => task())).finally(() => process.exit(code));
};

export const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const mayTakeLease = (held: LeaseRow, context: LeaseContext): boolean => {
  const silentFor = context.now - Date.parse(held.heartbeatAt);
  if (silentFor <= STALE_AFTER_MS) return false;
  if (held.host !== context.host) return false;
  return !context.alive(held.pid);
};

export const leaseRefusal = (held: LeaseRow, now: number): string =>
  `${held.ticket} is already running: run ${held.runId}, pid ${held.pid} on ${held.host}, last heartbeat ${Math.round((now - Date.parse(held.heartbeatAt)) / 1000)} s ago. Wait for it to finish or stop it, then launch again.`;

export type HeldLease = {
  stolenFrom?: LeaseRow;
  release: () => void;
};

export type AcquireOptions = {
  pid?: number;
  host?: string;
  now?: () => number;
  alive?: (pid: number) => boolean;
  heartbeatMs?: number;
};

export const acquireLease = (store: Store, options: AcquireOptions = {}): HeldLease => {
  const pid = options.pid ?? process.pid;
  const host = options.host ?? os.hostname();
  const now = options.now ?? Date.now;
  const alive = options.alive ?? pidAlive;
  const taken = store.takeLease({ pid, host, now: new Date(now()) }, (held) =>
    mayTakeLease(held, { now: now(), host, alive }),
  );
  if (!taken.ok) throw new Error(leaseRefusal(taken.held, now()));

  const timer = setInterval(
    () => store.heartbeat(new Date(now())),
    options.heartbeatMs ?? HEARTBEAT_MS,
  );
  timer.unref();

  let released = false;
  const onInterrupt = (): void => {
    release();
    exitAfterShutdown(130);
  };
  const onTerminate = (): void => {
    release();
    exitAfterShutdown(143);
  };
  const release = (): void => {
    if (released) return;
    released = true;
    clearInterval(timer);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    store.releaseLease();
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  return { stolenFrom: taken.stolenFrom, release };
};
