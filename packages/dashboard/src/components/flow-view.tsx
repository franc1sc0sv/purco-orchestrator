import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { TONES, WORKER_LABEL, WORKER_TONE, isWorkerBusy, type Tone } from "@/lib/colors";
import { formatCost, formatDuration, shortModel } from "@/lib/format";
import { STAGE_LABELS, type ForgeJob, type PipelineStage, type Stage, type Worker } from "@/lib/types";
import { cn } from "@/lib/utils";

type Box = {
  id: string;
  group: string;
  title: string;
  kind: string;
  tone: Tone;
  busy: boolean;
  start: number;
  end: number;
  status: string;
  facts: string;
  count: number;
};

type Column = { group: string; start: number; end: number; boxes: Box[] };

const JOB_TONE: Record<ForgeJob["state"], Tone> = { running: "running", done: "done", failed: "failed" };

const GROUP_OF_JOB: Record<string, string> = {
  harness: "harness",
  stryker: "baseline",
  suite: "repair",
  solo: "kill check",
  gates: "gates",
};

const ROLE_PREFIX = /^[A-Z-]+?-(?=[a-z0-9])/;

const groupOfStep = (step: string): string => {
  const parts = step.split(":");
  return parts.length >= 3 ? (parts[1] ?? step) : (parts[0] ?? step);
};

const groupOfJob = (job: ForgeJob): string =>
  job.kind === "recheck" ? `re-check ${job.label.replace(/^Re-check\s+/, "")}` : (GROUP_OF_JOB[job.kind] ?? job.kind);

const activeStage = (pipeline: PipelineStage[], workers: Worker[]): Stage => {
  const running = pipeline.find((stage) => stage.steps.some((step) => step.status === "running"));
  if (running) return running.stage;
  const latest = [...workers].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return latest?.stage ?? "plan";
};

const workerBox = (worker: Worker, live: boolean, now: number): Box => {
  const end = worker.endedAt ? Date.parse(worker.endedAt) : live ? now : Date.parse(worker.lastEventAt);
  return {
    id: worker.id,
    group: groupOfStep(worker.step),
    title: (worker.label || worker.role).replace(ROLE_PREFIX, ""),
    kind: `${worker.role} · ${shortModel(worker.model)}`,
    tone: WORKER_TONE[worker.state],
    busy: live && isWorkerBusy(worker.state),
    start: Date.parse(worker.startedAt),
    end,
    status: WORKER_LABEL[worker.state],
    facts: formatCost(worker.costUsd),
    count: 1,
  };
};

const jobBox = (job: ForgeJob, alive: boolean, now: number, progress: string | undefined): Box => {
  const running = job.state === "running" && alive;
  return {
    id: `job:${job.id}`,
    group: groupOfJob(job),
    title: job.label,
    kind: `${job.kind}${job.workers > 0 ? ` · ${job.workers} workers` : ""}`,
    tone: job.state === "running" && !alive ? "halted" : JOB_TONE[job.state],
    busy: running,
    start: Date.parse(job.startedAt),
    end: job.endedAt ? Date.parse(job.endedAt) : now,
    status: running ? "running" : job.state,
    facts: progress ?? job.detail,
    count: 1,
  };
};

const mergeRepeats = (boxes: Box[]): Box[] =>
  boxes.reduce<Box[]>((merged, box) => {
    const twin = merged.find((other) => other.title === box.title && other.kind === box.kind && !other.busy && !box.busy);
    if (!twin) return [...merged, box];
    twin.count += 1;
    twin.end = Math.max(twin.end, box.end);
    twin.tone = box.tone;
    twin.status = box.status;
    twin.id = box.id;
    return merged;
  }, []);

const columnsOf = (boxes: Box[]): Column[] => {
  const columns: Column[] = [];
  for (const box of [...boxes].sort((a, b) => a.start - b.start)) {
    const last = columns.at(-1);
    if (last && last.group === box.group) {
      last.boxes.push(box);
      last.end = Math.max(last.end, box.end);
    } else {
      columns.push({ group: box.group, start: box.start, end: box.end, boxes: [box] });
    }
  }
  return columns.map((column) => ({ ...column, boxes: mergeRepeats(column.boxes) }));
};

const latestRunOf = (workers: Worker[]): { runId: string; start: number } | undefined => {
  const latest = [...workers].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!latest) return undefined;
  const ofRun = workers.filter((worker) => worker.runId === latest.runId).map((worker) => Date.parse(worker.startedAt));
  return { runId: latest.runId, start: Math.min(...ofRun) };
};

const BoxCard = ({ box, selected, onSelect }: { box: Box; selected: boolean; onSelect: (id: string) => void }) => (
  <button
    type="button"
    onClick={() => onSelect(box.id)}
    className={cn(
      "w-44 rounded-lg border-2 p-2 text-left text-[11px] transition-colors",
      TONES[box.tone].vars,
      TONES[box.tone].node,
      box.id.startsWith("job:") && "border-dashed",
      box.busy && "animate-node-glow",
      selected && "ring-primary ring-2 ring-offset-2 ring-offset-background",
    )}
  >
    <div className="flex items-center gap-1.5">
      <span className={cn("size-2 shrink-0 rounded-full", TONES[box.tone].dot, box.busy && "animate-soft-pulse")} />
      <span className="truncate font-semibold" title={box.title}>
        {box.title}
      </span>
      {box.count > 1 ? <span className="text-muted-foreground ml-auto font-mono">×{box.count}</span> : null}
    </div>
    <div className="text-muted-foreground mt-1 truncate font-mono text-[10px]">{box.kind}</div>
    <div className="mt-1 flex justify-between gap-2 font-mono text-[10px]">
      <span className="truncate" title={box.facts}>
        {box.facts}
      </span>
      <span className="shrink-0">{formatDuration(box.end - box.start)}</span>
    </div>
  </button>
);

export const FlowView = ({
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
  const stage = activeStage(pipeline, workers);
  const staged = workers.filter((worker) => worker.role !== "lead" && (worker.stage ?? "plan") === stage);
  const run = latestRunOf(staged);
  const boxes = [
    ...staged.filter((worker) => worker.runId === run?.runId).map((worker) => workerBox(worker, live.has(worker.id), now)),
    ...(stage === "testing"
      ? jobs
          .filter((job) => run === undefined || Date.parse(job.startedAt) >= run.start - 60_000)
          .map((job) => jobBox(job, alive, now, progressOf(job)))
      : []),
  ];
  if (boxes.length === 0) {
    return <p className="text-muted-foreground p-4 text-sm">Nothing ran in {STAGE_LABELS[stage]} yet.</p>;
  }
  const columns = columnsOf(boxes);
  const start = Math.min(...boxes.map((box) => box.start));
  const end = Math.max(...boxes.map((box) => box.end));
  return (
    <div className="flex size-full flex-col gap-2">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="text-foreground font-semibold">{STAGE_LABELS[stage]}</span>
        <span>
          latest run · {boxes.length} item(s) · {formatDuration(end - start)}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex items-start gap-2 pb-3">
          {columns.map((column, index) => (
            <div key={`${column.group}-${column.start}`} className="flex items-start gap-2">
              {index > 0 ? <div className="text-muted-foreground pt-10 text-lg">→</div> : null}
              <div className="flex flex-col gap-2">
                <div className="px-1">
                  <div className="text-xs font-semibold capitalize">{column.group}</div>
                  <div className="text-muted-foreground font-mono text-[10px]">
                    +{formatDuration(column.start - start)} · {formatDuration(column.end - column.start)}
                  </div>
                </div>
                {column.boxes.map((box) => (
                  <BoxCard key={box.id} box={box} selected={box.id === selectedId} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
};
