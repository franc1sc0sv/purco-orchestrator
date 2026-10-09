import type { ForgeJob, Stage, Worker } from "@/lib/types";

export type FlowItem =
  | { kind: "worker"; worker: Worker; start: number; group: string }
  | { kind: "job"; job: ForgeJob; start: number; group: string; count: number };

export type Phase = { group: string; start: number; items: FlowItem[] };

const JOB_GROUP: Record<string, string> = {
  harness: "harness",
  stryker: "baseline",
  suite: "repair",
  solo: "kill check",
  gates: "gates",
};

const groupOfStep = (step: string): string => {
  const parts = step.split(":");
  return parts.length >= 3 ? (parts[1] ?? step) : (parts[0] ?? step);
};

const groupOfJob = (job: ForgeJob): string =>
  job.kind === "recheck" ? `re-check ${job.label.replace(/^Re-check\s+/, "")}` : (JOB_GROUP[job.kind] ?? job.kind);

const latestRun = (workers: Worker[]): { runId: string; start: number } | undefined => {
  const latest = [...workers].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!latest) return undefined;
  const starts = workers.filter((worker) => worker.runId === latest.runId).map((worker) => Date.parse(worker.startedAt));
  return { runId: latest.runId, start: Math.min(...starts) };
};

const JOB_WINDOW_MS = 60_000;

export const flowItems = (stage: Stage, workers: Worker[], jobs: ForgeJob[]): FlowItem[] => {
  const staged = workers.filter((worker) => worker.role !== "lead" && (worker.stage ?? "plan") === stage);
  const run = latestRun(staged);
  const workerItems: FlowItem[] = staged
    .filter((worker) => worker.runId === run?.runId)
    .map((worker) => ({ kind: "worker", worker, start: Date.parse(worker.startedAt), group: groupOfStep(worker.step) }));
  const jobItems: FlowItem[] =
    stage === "testing"
      ? jobs
          .filter((job) => run === undefined || Date.parse(job.startedAt) >= run.start - JOB_WINDOW_MS)
          .map((job) => ({ kind: "job", job, start: Date.parse(job.startedAt), group: groupOfJob(job), count: 1 }))
      : [];
  return [...workerItems, ...jobItems].sort((a, b) => a.start - b.start);
};

const mergeRepeatedJobs = (items: FlowItem[]): FlowItem[] =>
  items.reduce<FlowItem[]>((merged, item) => {
    if (item.kind !== "job" || item.job.state === "running") return [...merged, item];
    const twin = merged.find(
      (other): other is Extract<FlowItem, { kind: "job" }> =>
        other.kind === "job" && other.job.label === item.job.label && other.job.state !== "running",
    );
    if (!twin) return [...merged, item];
    twin.count += 1;
    twin.job = item.job;
    return merged;
  }, []);

export const phasesOf = (items: FlowItem[]): Phase[] => {
  const phases: Phase[] = [];
  for (const item of items) {
    const last = phases.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else phases.push({ group: item.group, start: item.start, items: [item] });
  }
  return phases.map((phase) => ({ ...phase, items: mergeRepeatedJobs(phase.items) }));
};
