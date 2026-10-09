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
  STAGE_LABELS,
  type ForgeJob,
  type PipelineStage,
  type StreamEvent,
  type Worker,
} from "@/lib/types";
import { flowItems, phasesOf, type FlowItem } from "@/lib/flow";
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
  count: number;
};

type PhaseData = { label: string; detail: string; tone: Tone; busy: boolean };

type PhaseNode = Node<PhaseData, "phase">;
type LeadNode = Node<LeadData, "lead">;
type JobNode = Node<JobData, "job">;
type StageNode = Node<StageData, "stage">;
type WorkerNode = Node<WorkerData, "worker">;

const ROW_HEIGHT = 136;
const PHASE_HEADER = 64;
const STAGE_X = 220;
const PHASE_X = 440;
const COLUMN_WIDTH = 260;
const EMPTY_STAGE_HEIGHT = 96;

const hidden = { opacity: 0, pointerEvents: "none" } as const;

const Anchors = () => (
  <>
    <Handle type="target" position={Position.Left} style={hidden} />
    <Handle type="source" position={Position.Right} style={hidden} />
    <Handle id="top" type="target" position={Position.Top} style={hidden} />
    <Handle id="bottom" type="source" position={Position.Bottom} style={hidden} />
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
        <span className="truncate font-semibold">
          {job.label}
          {data.count > 1 ? ` ×${data.count}` : ""}
        </span>
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

const PhaseView = ({ data }: NodeProps<PhaseNode>) => (
  <div
    className={cn(
      "w-52 rounded-full border-2 px-3 py-1.5 text-center",
      TONES[data.tone].vars,
      TONES[data.tone].node,
      data.busy && "animate-node-glow",
    )}
  >
    <div className="truncate text-xs font-semibold capitalize">{data.label}</div>
    <div className="text-muted-foreground truncate font-mono text-[10px]">{data.detail}</div>
    <Anchors />
  </div>
);

const nodeTypes = { lead: LeadView, stage: StageView, worker: WorkerView, job: JobView, phase: PhaseView };

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

const itemBusy = (item: FlowItem, liveIds: Set<string>, alive: boolean): boolean =>
  item.kind === "worker"
    ? liveIds.has(item.worker.id) && isWorkerBusy(item.worker.state)
    : alive && item.job.state === "running";

const itemEnd = (item: FlowItem, now: number): number =>
  item.kind === "worker"
    ? item.worker.endedAt
      ? Date.parse(item.worker.endedAt)
      : now
    : item.job.endedAt
      ? Date.parse(item.job.endedAt)
      : now;

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
  const groups = pipeline.map((stage) => {
    const phases = phasesOf(flowItems(stage.stage, workers, forge.jobs));
    const deepest = Math.max(0, ...phases.map((phase) => phase.items.length));
    return { stage, phases, height: deepest === 0 ? EMPTY_STAGE_HEIGHT : PHASE_HEADER + deepest * ROW_HEIGHT };
  });
  const totalHeight = groups.reduce((sum, group) => sum + group.height, 0);

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
  for (const { stage, phases, height } of groups) {
    const stageBusy = alive && stage.status === "running";
    nodes.push({
      id: `stage:${stage.stage}`,
      type: "stage",
      position: { x: STAGE_X, y: cursor + (phases.length > 0 ? PHASE_HEADER / 2 - 28 : height / 2 - 28) },
      data: { label: STAGE_LABELS[stage.stage], tone: STEP_TONE[stage.status], busy: stageBusy },
      draggable: false,
    } satisfies StageNode);
    edges.push({
      id: `lead->${stage.stage}`,
      source: "lead",
      target: `stage:${stage.stage}`,
      animated: stageBusy && !stuck,
      style: {
        stroke: TONES[STEP_TONE[stage.status]].color,
        strokeWidth: 2,
        strokeDasharray: stage.status === "waiting" ? WAITING_DASH : TONES[STEP_TONE[stage.status]].dash,
      },
    });
    phases.forEach((phase, column) => {
      const x = PHASE_X + column * COLUMN_WIDTH;
      const busy = phase.items.some((item) => itemBusy(item, liveIds, alive));
      const end = Math.max(...phase.items.map((item) => itemEnd(item, forge.now)));
      const phaseId = `phase:${stage.stage}:${column}`;
      const tone: Tone = busy ? "running" : "done";
      nodes.push({
        id: phaseId,
        type: "phase",
        position: { x, y: cursor },
        data: {
          label: phase.group,
          detail: `${phase.items.length} item(s) · ${formatDuration(end - phase.start)}`,
          tone,
          busy,
        },
        draggable: false,
      } satisfies PhaseNode);
      edges.push({
        id: `${column === 0 ? `stage:${stage.stage}` : `phase:${stage.stage}:${column - 1}`}->${phaseId}`,
        source: column === 0 ? `stage:${stage.stage}` : `phase:${stage.stage}:${column - 1}`,
        target: phaseId,
        animated: busy && !stuck,
        style: { stroke: TONES[tone].color, strokeWidth: 2, opacity: busy ? 1 : 0.5 },
      });
      const nodeIdOf = (item: FlowItem): string =>
        item.kind === "worker" ? `worker:${item.worker.id}` : `job:${item.job.id}`;
      const down = (row: number, target: string) => ({
        id: `${row === 0 ? phaseId : nodeIdOf(phase.items[row - 1] as FlowItem)}->${target}`,
        source: row === 0 ? phaseId : nodeIdOf(phase.items[row - 1] as FlowItem),
        sourceHandle: "bottom",
        target,
        targetHandle: "top",
        type: "straight",
      });
      phase.items.forEach((item, row) => {
        const y = cursor + PHASE_HEADER + row * ROW_HEIGHT;
        if (item.kind === "worker") {
          const { worker } = item;
          const live = liveIds.has(worker.id);
          nodes.push({
            id: `worker:${worker.id}`,
            type: "worker",
            position: { x, y },
            data: {
              worker,
              busy: live && isWorkerBusy(worker.state),
              ended: !live,
              chip: view.chips.get(worker.id),
              selected: view.selectedId === worker.id,
            },
            draggable: false,
          } satisfies WorkerNode);
          edges.push({ ...down(row, `worker:${worker.id}`), ...workerEdge(worker, live, stuck) });
          return;
        }
        const { job } = item;
        const jobBusy = alive && job.state === "running";
        const jobTone: Tone = job.state === "running" && !alive ? "halted" : JOB_TONE[job.state];
        nodes.push({
          id: `job:${job.id}`,
          type: "job",
          position: { x, y },
          data: {
            job,
            tone: jobTone,
            busy: jobBusy,
            elapsedMs: (job.endedAt ? Date.parse(job.endedAt) : forge.now) - Date.parse(job.startedAt),
            progress: forge.progressOf(job),
            selected: view.selectedId === `job:${job.id}`,
            count: item.count,
          },
          draggable: false,
        } satisfies JobNode);
        edges.push({
          ...down(row, `job:${job.id}`),
          animated: jobBusy && !stuck,
          style: { stroke: TONES[jobTone].color, strokeWidth: 2, strokeDasharray: TONES[jobTone].dash, opacity: jobBusy ? 1 : 0.3 },
        });
      });
    });
    cursor += height;
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
