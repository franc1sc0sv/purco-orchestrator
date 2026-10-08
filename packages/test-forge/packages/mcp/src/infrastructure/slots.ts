import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { join } from "node:path";

const SLOTS_DIRECTORY = join(homedir(), ".test-forge", "slots");

const RESERVED_CORES = 2;

export type SlotLease = { count: number; release: () => void };

const capacity = (): number => Math.max(2, cpus().length - RESERVED_CORES);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const heldOf = (file: string): number => {
  try {
    const lease = JSON.parse(readFileSync(file, "utf8")) as { pid: number; count: number };
    if (alive(lease.pid)) return lease.count;
  } catch {
    return 0;
  }
  rmSync(file, { force: true });
  return 0;
};

const heldSlots = (): number =>
  readdirSync(SLOTS_DIRECTORY).reduce((sum, name) => sum + heldOf(join(SLOTS_DIRECTORY, name)), 0);

export const leaseSlots = (wanted: number, minimum: number): SlotLease => {
  mkdirSync(SLOTS_DIRECTORY, { recursive: true });
  const free = capacity() - heldSlots();
  const count = Math.max(minimum, Math.min(wanted, free));
  const file = join(SLOTS_DIRECTORY, `${process.pid}-${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify({ pid: process.pid, count }));
  return { count, release: () => rmSync(file, { force: true }) };
};
