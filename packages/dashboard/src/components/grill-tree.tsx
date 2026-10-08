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
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  changedRecommendation,
  clip,
  placeQuestions,
  shortQuestion,
} from "@/lib/grill-tree";
import type { GrillQuestion, GrillStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type TreeData = { question: GrillQuestion; selected: boolean };
type TreeNode = Node<TreeData, "question">;

const hidden = { opacity: 0, pointerEvents: "none" } as const;

const STATUS_SUB: Record<GrillStatus, string> = {
  open: "Open now",
  upcoming: "Upcoming",
  answered: "",
  parked: "Parked",
  settled: "Settled by the lead",
  assumed: "Assumed",
};

const STATUS_STYLE: Record<GrillStatus, string> = {
  open: "bg-primary text-primary-foreground border-primary animate-node-glow",
  upcoming: "border-dashed border-blue-3 bg-card text-muted-foreground",
  answered: "border-blue-2 bg-card",
  parked: "border-dashed border-primary bg-card text-primary",
  settled: "border-blue-2 bg-secondary text-muted-foreground",
  assumed: "border-blue-2 bg-secondary text-muted-foreground",
};

const subOf = (question: GrillQuestion): string =>
  question.status === "answered" && question.answer !== null
    ? clip(question.answer, 28)
    : STATUS_SUB[question.status];

const QuestionView = ({ data }: NodeProps<TreeNode>) => {
  const { question, selected } = data;
  const changed = changedRecommendation(question);
  return (
    <div className="relative" style={{ width: NODE_WIDTH, height: NODE_HEIGHT }} title={question.question}>
      {changed ? (
        <span className="text-primary absolute -top-4 right-1 font-mono text-[10px] font-semibold">YOU</span>
      ) : null}
      <div
        className={cn(
          "flex size-full cursor-pointer flex-col justify-center gap-0.5 rounded-lg border px-3 shadow-xs",
          STATUS_STYLE[question.status],
          changed && "bg-blue-1 border-primary border-2",
          selected && "ring-primary ring-2 ring-offset-2 ring-offset-background",
        )}
      >
        <span className="line-clamp-2 text-sm leading-tight font-semibold">
          Q{question.id} {shortQuestion(question)}
        </span>
        <span className={cn("truncate text-xs", question.status === "open" ? "opacity-90" : "text-muted-foreground")}>
          {subOf(question)}
        </span>
      </div>
      <Handle type="target" position={Position.Top} style={hidden} />
      <Handle type="source" position={Position.Bottom} style={hidden} />
    </div>
  );
};

const nodeTypes = { question: QuestionView };

const buildGraph = (questions: GrillQuestion[], selectedId: number) => {
  const placed = placeQuestions(questions);
  const ids = new Set(questions.map((question) => question.id));
  const nodes: TreeNode[] = placed.map(({ question, x, y }) => ({
    id: String(question.id),
    type: "question",
    position: { x, y },
    data: { question, selected: question.id === selectedId },
    draggable: false,
  }));
  const edges: Edge[] = questions.flatMap((question) =>
    question.dependsOn
      .filter((parent) => ids.has(parent))
      .map((parent) => ({
        id: `${parent}->${question.id}`,
        source: String(parent),
        target: String(question.id),
        type: "smoothstep",
        style: { stroke: "var(--blue-3)", strokeWidth: 1.5, strokeDasharray: "5 4" },
      })),
  );
  return { nodes, edges };
};

export const GrillTree = ({
  questions,
  selectedId,
  onSelect,
}: {
  questions: GrillQuestion[];
  selectedId: number;
  onSelect: (id: number) => void;
}) => {
  const graph = useMemo(() => buildGraph(questions, selectedId), [questions, selectedId]);
  const structure = questions.map((question) => `${question.id}:${question.dependsOn.join(",")}`).join("|");
  return (
    <ReactFlow
      key={structure}
      nodes={graph.nodes}
      edges={graph.edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(Number(node.id))}
      fitView
      fitViewOptions={{ padding: 0.03, maxZoom: 1.6 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={28} size={1} color="var(--border)" />
    </ReactFlow>
  );
};
