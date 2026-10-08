import { eventsOfWorker } from "@/lib/agent-activity";
import type { PipelineStage, PipelineStep, StepStatus, StreamEvent, TicketDetail, Worker, WorkerState } from "@/lib/types";

const FINISHED: StepStatus[] = ["done", "skipped"];

export const replayTimeOf = (params: URLSearchParams): number | null => {
  const raw = params.get("t");
  const parsed = raw === null ? Number.NaN : Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

const stepAt = (step: PipelineStep, at: number): PipelineStep => {
  if (step.startedAt === undefined || Date.parse(step.startedAt) > at) {
    return { ...step, status: "pending", startedAt: undefined, endedAt: undefined };
  }
  if (step.endedAt === undefined || Date.parse(step.endedAt) > at) {
    return { ...step, status: "running", endedAt: undefined };
  }
  return step;
};

const stageStatusOf = (steps: PipelineStep[]): StepStatus => {
  if (steps.some((step) => step.status === "running")) return "running";
  if (steps.length > 0 && steps.every((step) => FINISHED.includes(step.status))) return "done";
  if (steps.some((step) => step.status === "failed")) return "failed";
  return steps.some((step) => FINISHED.includes(step.status)) ? "running" : "pending";
};

const pipelineAt = (pipeline: PipelineStage[], at: number): PipelineStage[] =>
  pipeline.map((stage) => {
    const steps = stage.steps.map((step) => stepAt(step, at));
    return { ...stage, steps, status: stageStatusOf(steps) };
  });

const workerStateAt = (worker: Worker, at: number, events: StreamEvent[]): WorkerState => {
  if (worker.endedAt !== undefined && Date.parse(worker.endedAt) <= at) return worker.state;
  const last = eventsOfWorker(events, worker).at(-1);
  return last?.kind === "tool_use" ? "tool" : "thinking";
};

export const detailAt = (detail: TicketDetail, at: number, events: StreamEvent[]): TicketDetail => {
  const workers = detail.workers
    .filter((worker) => Date.parse(worker.startedAt) <= at)
    .map((worker) => ({ ...worker, state: workerStateAt(worker, at, events) }));
  const liveWorkerIds = workers
    .filter((worker) => worker.endedAt === undefined || Date.parse(worker.endedAt) > at)
    .map((worker) => worker.id);
  return {
    ...detail,
    summary: { ...detail.summary, activeRun: null, liveAgents: liveWorkerIds.length },
    workers,
    liveWorkerIds,
    pipeline: pipelineAt(detail.pipeline, at),
    alerts: detail.alerts.filter((alert) => Date.parse(alert.at) <= at),
    decisions: detail.decisions.filter((decision) => Date.parse(decision.at) <= at),
    samples: detail.samples.filter((sample) => Date.parse(sample.at) <= at),
    events,
  };
};
