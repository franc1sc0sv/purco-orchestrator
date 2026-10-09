import { ScrollArea } from "@/components/ui/scroll-area";
import { TONES, WORKER_LABEL, WORKER_TONE, isWorkerBusy, type Tone } from "@/lib/colors";
import { formatCost, formatDuration, shortModel } from "@/lib/format";
import { STAGE_LABELS, type ForgeJob, type PipelineStage, type Stage, type Worker } from "@/lib/types";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  title: string;
  kind: string;
  detail: string;
  tone: Tone;
  busy: boolean;
  start: number;
  end: number;
  status: string;
};

const AXIS_STEPS_MS = [10, 30, 60, 120, 300, 600, 900, 1800, 3600].map((seconds) => seconds * 1000);
const TARGET_MARKS = 6;
const JOB_TONE: Record<ForgeJob["state"], Tone> = { running: "running", done: "done", failed: "failed" };

const activeStage = (pipeline: PipelineStage[], workers: Worker[], jobs: ForgeJob[]): Stage => {
  const running = pipeline.find((stage) => stage.steps.some((step) => step.status === "running"));
  if (running) return running.stage;
  const latestWorker = [...workers].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const latestJob = [...jobs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (latestJob && (!latestWorker || latestJob.startedAt > latestWorker.startedAt)) return "testing";
  return latestWorker?.stage ?? "plan";
};

const workerRow = (worker: Worker, live: boolean, now: number): Row => ({
  id: worker.id,
  title: worker.label || worker.role,
  kind: `${worker.role} · ${shortModel(worker.model)}`,
  detail: `${formatCost(worker.costUsd)} · ${worker.action || WORKER_LABEL[worker.state]}`,
  tone: WORKER_TONE[worker.state],
  busy: live && isWorkerBusy(worker.state),
  start: Date.parse(worker.startedAt),
  end: worker.endedAt ? Date.parse(worker.endedAt) : live ? now : Date.parse(worker.lastEventAt),
  status: WORKER_LABEL[worker.state],
});

const jobRow = (job: ForgeJob, alive: boolean, now: number, progress: string | undefined): Row => {
  const running = job.state === "running" && alive;
  return {
    id: `job:${job.id}`,
    title: job.label,
    kind: `${job.kind}${job.workers > 0 ? ` · ${job.workers} workers` : ""}`,
    detail: progress ?? job.detail,
    tone: job.state === "running" && !alive ? "halted" : JOB_TONE[job.state],
    busy: running,
    start: Date.parse(job.startedAt),
    end: job.endedAt ? Date.parse(job.endedAt) : now,
    status: running ? "running" : job.state,
  };
};

const marksOf = (span: number): number[] => {
  const step = AXIS_STEPS_MS.find((candidate) => span / candidate <= TARGET_MARKS) ?? AXIS_STEPS_MS.at(-1) ?? span;
  return Array.from({ length: Math.floor(span / step) + 1 }, (_, index) => index * step);
};

const markLabel = (ms: number): string =>
  ms === 0 ? "0m" : ms % 60000 === 0 ? `${ms / 60000}m` : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;

export const ActivityTimeline = ({
  workers,
  liveWorkerIds,
  jobs,
  pipeline,
  alive,
  now,
  selectedId,
  progressOf,
  onSelect,
}: {
  workers: Worker[];
  liveWorkerIds: string[];
  jobs: ForgeJob[];
  pipeline: PipelineStage[];
  alive: boolean;
  now: number;
  selectedId: string | undefined;
  progressOf: (job: ForgeJob) => string | undefined;
  onSelect: (id: string) => void;
}) => {
  const live = new Set(liveWorkerIds);
  const stage = activeStage(pipeline, workers, jobs);
  const rows = [
    ...workers
      .filter((worker) => worker.role !== "lead" && (worker.stage ?? "plan") === stage)
      .map((worker) => workerRow(worker, live.has(worker.id), now)),
    ...(stage === "testing" ? jobs.map((job) => jobRow(job, alive, now, progressOf(job))) : []),
  ].sort((a, b) => a.start - b.start);
  if (rows.length === 0) {
    return <p className="text-muted-foreground p-4 text-sm">Nothing ran in {STAGE_LABELS[stage]} yet.</p>;
  }
  const start = Math.min(...rows.map((row) => row.start));
  const end = Math.max(now, ...rows.map((row) => row.end), start + 1000);
  const span = end - start;
  const at = (time: number): number => Math.min(100, Math.max(0, ((time - start) / span) * 100));
  return (
    <div className="flex size-full flex-col gap-2">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="text-foreground font-semibold">{STAGE_LABELS[stage]}</span>
        <span>
          {rows.length} item(s) · {formatDuration(span)}
        </span>
      </div>
      <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-x-3">
        <div />
        <div className="relative h-5 border-b">
          {marksOf(span).map((mark) => (
            <span
              key={mark}
              className="text-muted-foreground absolute -translate-x-1/2 font-mono text-[10px]"
              style={{ left: `${at(start + mark)}%` }}
            >
              {markLabel(mark)}
            </span>
          ))}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 pr-3">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect(row.id)}
              className={cn(
                "contents text-left",
                row.id === selectedId && "[&>div]:bg-blue-1",
              )}
            >
              <div className="min-w-0 rounded-md px-2 py-1">
                <div className="truncate text-xs font-semibold" title={row.title}>
                  {row.title}
                </div>
                <div className="text-muted-foreground truncate font-mono text-[10px]">{row.kind}</div>
              </div>
              <div className="relative rounded-md py-1">
                {marksOf(span).map((mark) => (
                  <span
                    key={mark}
                    className="bg-border absolute top-0 bottom-0 w-px"
                    style={{ left: `${at(start + mark)}%` }}
                  />
                ))}
                <div
                  className={cn(
                    "relative flex h-8 min-w-1 items-center overflow-hidden rounded-md border px-2 text-[10px]",
                    TONES[row.tone].vars,
                    TONES[row.tone].soft,
                    row.busy && "animate-soft-pulse",
                  )}
                  style={{ marginLeft: `${at(row.start)}%`, width: `${Math.max(0.5, at(row.end) - at(row.start))}%` }}
                  title={`${row.title}: ${row.status}, ${formatDuration(row.end - row.start)}. ${row.detail}`}
                >
                  <span className="truncate font-mono">
                    {formatDuration(row.end - row.start)} · {row.status} · {row.detail}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
