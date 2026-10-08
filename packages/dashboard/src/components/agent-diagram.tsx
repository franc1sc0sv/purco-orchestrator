import {
  Background,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { Counter } from "@/components/counter";
import { ToneBadge } from "@/components/state-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { eventsOfWorker, nowDoing, shortTarget, toolLabel } from "@/lib/agent-activity";
import { STEP_TONE, TONES, WORKER_LABEL, WORKER_TONE, isWorkerBusy, type Tone } from "@/lib/colors";
import { formatCost, formatDuration, formatTokens, shortModel } from "@/lib/format";
import {
  STAGES,
  STAGE_LABELS,
  type ForgeJob,
  type PipelineStage,
  type Stage,
  type StreamEvent,
  type Worker,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type LeadData = { tone: Tone; busy: boolean };
type StageData = { label: string; tone: Tone; busy: boolean };
type WorkerData = { worker: Worker; busy: boolean; ended: boolean; chip: string | undefined; selected: boolean };

type JobData = {
  job: ForgeJob;
  tone: Tone;
  busy: boolean;
  elapsedMs: number;
  progress: string | undefined;
  selected: boolean;
};

type LeadNode = Node<LeadData, "lead">;
type JobNode = Node<JobData, "job">;
type StageNode = Node<StageData, "stage">;
type WorkerNode = Node<WorkerData, "worker">;

const ROW_HEIGHT = 136;
const STAGE_X = 220;
const WORKER_X = 520;
const WORKER_COLUMN_WIDTH = 240;
const WORKER_COLUMNS = 2;

const rowsOf = (count: number): number => Math.max(1, Math.ceil(count / WORKER_COLUMNS));
const MAX_ENDED_PER_STAGE = 5;

const hidden = { opacity: 0, pointerEvents: "none" } as const;

const Anchors = () => (
  <>
    <Handle type="target" position={Position.Left} style={hidden} />
    <Handle type="source" position={Position.Right} style={hidden} />
  </>
);

const ToneLabel = ({ tone }: { tone: Tone }) =>
  TONES[tone].label === null ? null : (
    <span className="font-mono text-[10px] tracking-wider">{TONES[tone].label}</span>
  );

const LeadView = ({ data }: NodeProps<LeadNode>) => (
  <Card
    className={cn(
      "size-24 items-center justify-center gap-0 rounded-full border-2 py-0 font-mono text-sm font-semibold",
      TONES[data.tone].vars,
      TONES[data.tone].node,
      data.busy && "animate-node-glow",
    )}
  >
    lead
    <ToneLabel tone={data.tone} />
    <Anchors />
  </Card>
);

const StageView = ({ data }: NodeProps<StageNode>) => (
  <Card
    className={cn(
      "h-14 w-36 items-center justify-center gap-0 border-2 py-0 text-sm font-medium",
      TONES[data.tone].vars,
      TONES[data.tone].node,
      data.busy && "animate-node-glow",
    )}
  >
    {data.label}
    <ToneLabel tone={data.tone} />
    <Anchors />
  </Card>
);

const WorkerView = ({ data }: NodeProps<WorkerNode>) => {
  const { worker } = data;
  const tone = WORKER_TONE[worker.state];
  const tokens = worker.tokensIn + worker.tokensOut + worker.cacheWrite;
  return (
    <div className="relative">
      <Card
        className={cn(
          "w-52 cursor-pointer gap-1 border-2 p-2.5 text-xs transition-opacity duration-1000",
          TONES[tone].vars,
          TONES[tone].node,
          data.busy && "animate-node-glow",
          data.ended && "opacity-40",
          data.selected && "ring-primary ring-2 ring-offset-2 ring-offset-background",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{worker.role}</span>
          <Badge variant="secondary" className="font-mono">
            {shortModel(worker.model)}
          </Badge>
        </div>
        <ToneBadge tone={tone} pulse={data.busy} className="normal-case tracking-normal">
          {WORKER_LABEL[worker.state]}
        </ToneBadge>
        <div className="text-muted-foreground truncate font-mono" title={worker.action}>
          {worker.action || "-"}
        </div>
        <div className="flex justify-between font-mono">
          <Counter value={tokens} format={formatTokens} />
          <Counter value={worker.costUsd} format={formatCost} />
        </div>
        <Anchors />
      </Card>
      {data.chip ? (
        <div className="bg-blue-1 text-primary mt-1.5 w-52 truncate rounded-md px-2 py-1 font-mono text-[11px]">
          {data.chip}
        </div>
      ) : null}
    </div>
  );
};

const JobView = ({ data }: NodeProps<JobNode>) => {
  const { job } = data;
  return (
    <Card
      className={cn(
        "w-52 cursor-pointer gap-1 border-2 border-dashed p-2.5 text-xs transition-opacity duration-1000",
        TONES[data.tone].vars,
        TONES[data.tone].node,
        data.busy && "animate-node-glow",
        !data.busy && !data.selected && "opacity-40",
        data.selected && "ring-primary ring-2 ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{job.label}</span>
        <Badge variant="secondary" className="font-mono">
          {job.kind}
        </Badge>
      </div>
      <ToneBadge tone={data.tone} pulse={data.busy} className="normal-case tracking-normal">
        {data.busy ? "running" : job.state}
      </ToneBadge>
      <div className="text-muted-foreground truncate font-mono" title={job.detail}>
        {data.progress ?? job.detail}
      </div>
      <div className="flex justify-between font-mono">
        <span>{job.workers > 0 ? `${job.workers} workers` : "-"}</span>
        <span>{formatDuration(data.elapsedMs)}</span>
      </div>
      <Anchors />
    </Card>
  );
};

const JOB_TONE: Record<ForgeJob["state"], Tone> = { running: "running", done: "done", failed: "failed" };

const FIT_PADDING = 0.04;

const Refit = () => {
  const { fitView } = useReactFlow();
  const size = useStore((state) => `${state.width}x${state.height}`);
  useEffect(() => {
    void fitView({ padding: FIT_PADDING });
  }, [fitView, size]);
  return null;
};

const nodeTypes = { lead: LeadView, stage: StageView, worker: WorkerView, job: JobView };

const stageOf = (worker: Worker): Stage => worker.stage ?? "plan";

const visibleWorkers = (workers: Worker[], liveIds: Set<string>): Worker[] => {
  const live = workers.filter((worker) => liveIds.has(worker.id));
  const ended = workers.filter((worker) => !liveIds.has(worker.id));
  const keptEnded = STAGES.flatMap((stage) =>
    ended.filter((worker) => stageOf(worker) === stage).slice(-MAX_ENDED_PER_STAGE),
  );
  return [...keptEnded, ...live];
};

const WAITING_DASH = "6 4";

const workerEdge = (worker: Worker, live: boolean, stuck: boolean): Pick<Edge, "animated" | "style"> => {
  const busy = live && isWorkerBusy(worker.state);
  const tone: Tone = stuck && busy ? "stuck" : WORKER_TONE[worker.state];
  const waiting = tone === "waiting";
  return {
    animated: busy && !stuck,
    style: {
      stroke: TONES[tone].color,
      strokeWidth: 2,
      strokeDasharray: waiting ? WAITING_DASH : TONES[tone].dash,
      opacity: live ? 1 : 0.3,
    },
  };
};

const buildGraph = (
  workers: Worker[],
  liveIds: Set<string>,
  pipeline: PipelineStage[],
  alive: boolean,
  stuck: boolean,
  view: { chips: Map<string, string>; selectedId: string | undefined },
  forge: { jobs: ForgeJob[]; progressOf: (job: ForgeJob) => string | undefined; now: number },
): { nodes: Node[]; edges: Edge[]; height: number } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const leadWorker = workers.find((worker) => worker.role === "lead" && liveIds.has(worker.id));
  const shown = visibleWorkers(
    workers.filter((worker) => worker.role !== "lead"),
    liveIds,
  );
  const groups = pipeline.map((stage) => ({
    stage,
    own: shown.filter((worker) => stageOf(worker) === stage.stage),
    jobs: stage.stage === "testing" ? forge.jobs : [],
  }));
  const totalHeight = groups.reduce(
    (sum, group) => sum + rowsOf(group.own.length + group.jobs.length) * ROW_HEIGHT,
    0,
  );

  nodes.push({
    id: "lead",
    type: "lead",
    position: { x: 0, y: totalHeight / 2 - 48 },
    data: {
      tone: leadWorker ? WORKER_TONE[leadWorker.state] : "idle",
      busy: leadWorker !== undefined && isWorkerBusy(leadWorker.state),
    },
    draggable: false,
  } satisfies LeadNode);

  let cursor = 0;
  for (const { stage, own, jobs } of groups) {
    const groupHeight = rowsOf(own.length + jobs.length) * ROW_HEIGHT;
    const busy = own.some((worker) => liveIds.has(worker.id) && isWorkerBusy(worker.state));
    nodes.push({
      id: `stage:${stage.stage}`,
      type: "stage",
      position: { x: STAGE_X, y: cursor + groupHeight / 2 - 28 },
      data: {
        label: STAGE_LABELS[stage.stage],
        tone: STEP_TONE[stage.status],
        busy: alive && stage.status === "running",
      },
      draggable: false,
    } satisfies StageNode);
    edges.push({
      id: `lead->${stage.stage}`,
      source: "lead",
      target: `stage:${stage.stage}`,
      animated: busy && !stuck,
      style: {
        stroke: TONES[STEP_TONE[stage.status]].color,
        strokeWidth: 2,
        strokeDasharray:
          stage.status === "waiting" ? WAITING_DASH : TONES[STEP_TONE[stage.status]].dash,
      },
    });
    own.forEach((worker, index) => {
      const live = liveIds.has(worker.id);
      nodes.push({
        id: `worker:${worker.id}`,
        type: "worker",
        position: {
          x: WORKER_X + (index % WORKER_COLUMNS) * WORKER_COLUMN_WIDTH,
          y: cursor + Math.floor(index / WORKER_COLUMNS) * ROW_HEIGHT + 6,
        },
        data: {
          worker,
          busy: live && isWorkerBusy(worker.state),
          ended: !live,
          chip: view.chips.get(worker.id),
          selected: view.selectedId === worker.id,
        },
        draggable: false,
      } satisfies WorkerNode);
      edges.push({
        id: `${stage.stage}->${worker.id}`,
        source: index % WORKER_COLUMNS === 0 ? `stage:${stage.stage}` : `worker:${own[index - 1]?.id}`,
        target: `worker:${worker.id}`,
        ...workerEdge(worker, live, stuck),
      });
    });
    jobs.forEach((job, offset) => {
      const index = own.length + offset;
      const busy = alive && job.state === "running";
      const tone: Tone = job.state === "running" && !alive ? "halted" : JOB_TONE[job.state];
      const previous = index === 0 ? undefined : index <= own.length ? `worker:${own[index - 1]?.id}` : `job:${jobs[offset - 1]?.id}`;
      nodes.push({
        id: `job:${job.id}`,
        type: "job",
        position: {
          x: WORKER_X + (index % WORKER_COLUMNS) * WORKER_COLUMN_WIDTH,
          y: cursor + Math.floor(index / WORKER_COLUMNS) * ROW_HEIGHT + 6,
        },
        data: {
          job,
          tone,
          busy,
          elapsedMs: (job.endedAt ? Date.parse(job.endedAt) : forge.now) - Date.parse(job.startedAt),
          progress: forge.progressOf(job),
          selected: view.selectedId === `job:${job.id}`,
        },
        draggable: false,
      } satisfies JobNode);
      edges.push({
        id: `${stage.stage}->job:${job.id}`,
        source: index % WORKER_COLUMNS === 0 || previous === undefined ? `stage:${stage.stage}` : previous,
        target: `job:${job.id}`,
        animated: busy && !stuck,
        style: {
          stroke: TONES[tone].color,
          strokeWidth: 2,
          strokeDasharray: TONES[tone].dash,
          opacity: busy ? 1 : 0.3,
        },
      });
    });
    cursor += groupHeight;
  }
  return { nodes, edges, height: totalHeight };
};

export const AgentDiagram = ({
  workers,
  liveWorkerIds,
  pipeline,
  alive,
  stuck,
  events,
  jobs,
  progressOf,
  now,
  selectedId,
  onSelect,
}: {
  workers: Worker[];
  liveWorkerIds: string[];
  pipeline: PipelineStage[];
  alive: boolean;
  stuck: boolean;
  events: StreamEvent[];
  jobs: ForgeJob[];
  progressOf: (job: ForgeJob) => string | undefined;
  now: number;
  selectedId: string | undefined;
  onSelect: (workerId: string) => void;
}) => {
  const chips = useMemo(() => {
    const live = new Set(liveWorkerIds);
    const entries = workers
      .filter((worker) => live.has(worker.id))
      .flatMap((worker): [string, string][] => {
        const doing = nowDoing(eventsOfWorker(events, worker));
        return doing ? [[worker.id, `${toolLabel(doing.tool)} · ${shortTarget(doing.cmd)}`.replace(/ · $/, "")]] : [];
      });
    return new Map(entries);
  }, [workers, liveWorkerIds, events]);
  const graph = useMemo(
    () =>
      buildGraph(workers, new Set(liveWorkerIds), pipeline, alive, stuck, { chips, selectedId }, { jobs, progressOf, now }),
    [workers, liveWorkerIds, pipeline, alive, stuck, chips, selectedId, jobs, progressOf, now],
  );
  const structure = graph.nodes.map((node) => node.id).join("|");
  return (
    <div className="size-full">
      <ReactFlow
        key={structure}
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => {
          if (node.type === "worker") onSelect(node.id.replace(/^worker:/, ""));
          if (node.type === "job") onSelect(node.id);
        }}
        fitView
        fitViewOptions={{ padding: FIT_PADDING }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
      >
        <Refit />
        <Background gap={28} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  );
};
