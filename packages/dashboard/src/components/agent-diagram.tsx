import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useMemo } from "react";
import { Counter } from "@/components/counter";
import { ToneBadge } from "@/components/state-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { STEP_TONE, TONES, WORKER_LABEL, WORKER_TONE, isWorkerBusy, type Tone } from "@/lib/colors";
import { formatCost, formatTokens, shortModel } from "@/lib/format";
import {
  STAGES,
  STAGE_LABELS,
  type PipelineStage,
  type Stage,
  type Worker,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type LeadData = { tone: Tone; busy: boolean };
type StageData = { label: string; tone: Tone; busy: boolean };
type WorkerData = { worker: Worker; busy: boolean; ended: boolean };

type LeadNode = Node<LeadData, "lead">;
type StageNode = Node<StageData, "stage">;
type WorkerNode = Node<WorkerData, "worker">;

const ROW_HEIGHT = 130;
const STAGE_X = 220;
const WORKER_X = 520;
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
    <Card
      className={cn(
        "w-52 gap-1 border-2 p-2.5 text-xs transition-opacity duration-1000",
        TONES[tone].vars,
        TONES[tone].node,
        data.busy && "animate-node-glow",
        data.ended && "opacity-40",
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
  );
};

const nodeTypes = { lead: LeadView, stage: StageView, worker: WorkerView };

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
  }));
  const totalHeight = groups.reduce((sum, group) => sum + Math.max(1, group.own.length) * ROW_HEIGHT, 0);

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
  for (const { stage, own } of groups) {
    const groupHeight = Math.max(1, own.length) * ROW_HEIGHT;
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
        position: { x: WORKER_X, y: cursor + index * ROW_HEIGHT + 6 },
        data: { worker, busy: live && isWorkerBusy(worker.state), ended: !live },
        draggable: false,
      } satisfies WorkerNode);
      edges.push({
        id: `${stage.stage}->${worker.id}`,
        source: `stage:${stage.stage}`,
        target: `worker:${worker.id}`,
        ...workerEdge(worker, live, stuck),
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
}: {
  workers: Worker[];
  liveWorkerIds: string[];
  pipeline: PipelineStage[];
  alive: boolean;
  stuck: boolean;
}) => {
  const graph = useMemo(
    () => buildGraph(workers, new Set(liveWorkerIds), pipeline, alive, stuck),
    [workers, liveWorkerIds, pipeline, alive, stuck],
  );
  const structure = graph.nodes.map((node) => node.id).join("|");
  return (
    <div className="size-full">
      <ReactFlow
        key={structure}
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={28} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  );
};
