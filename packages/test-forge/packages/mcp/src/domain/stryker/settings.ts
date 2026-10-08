import type { MutantOutcome } from "test-forge-contracts/mutation";

export const MAX_STRYKER_CONCURRENCY = 12;

export const RESERVED_CORES = 3;

export const TEMPLATES_PER_WORKER = 4;

export const TIMEOUT_FACTOR = 1.5;

export const TIMEOUT_MS = 20_000;

export const strykerConcurrency = (cpuCount: number): number =>
  Math.max(1, Math.min(MAX_STRYKER_CONCURRENCY, cpuCount - RESERVED_CORES));

export const templateCountFor = (concurrency: number): number =>
  TEMPLATES_PER_WORKER * concurrency;

export const FAST_POSTGRES_SETTINGS: Readonly<Record<string, string>> = {
  fsync: "off",
  synchronous_commit: "off",
  full_page_writes: "off",
};

const OUTCOME_BY_STATUS: Readonly<Record<string, MutantOutcome>> = {
  Killed: "killed",
  Survived: "survived",
  NoCoverage: "no_coverage",
  Timeout: "killed_by_timeout",
  CompileError: "unviable",
  RuntimeError: "error",
  Ignored: "unviable",
  Pending: "pending",
};

export const outcomeOfStatus = (status: string): MutantOutcome =>
  OUTCOME_BY_STATUS[status] ?? "error";
