import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import type { GrillDiagram as Diagram, GrillDiagramMode } from "@/lib/types";
import { cn } from "@/lib/utils";

type DiagramData = { label: string; sub?: string; mode: GrillDiagramMode };
type DiagramNode = Node<DiagramData, "step">;

const NODE_WIDTH = 150;
const COLUMN_GAP = 70;
const ROW_GAP = 70;

const hidden = { opacity: 0, pointerEvents: "none" } as const;

const MODE_STYLE: Record<GrillDiagramMode, string> = {
  now: "border-blue-2 bg-card",
  changed: "border-primary border-2 bg-blue-1",
  new: "border-primary bg-primary text-primary-foreground",
};

const StepView = ({ data }: NodeProps<DiagramNode>) => (
  <div
    className={cn("flex flex-col justify-center rounded-lg border px-3 py-2 shadow-xs", MODE_STYLE[data.mode])}
    style={{ width: NODE_WIDTH }}
  >
    <span className="truncate text-xs font-semibold">{data.label}</span>
    {data.sub ? <span className="truncate text-[11px] opacity-80">{data.sub}</span> : null}
    <Handle type="target" position={Position.Left} style={hidden} />
    <Handle type="source" position={Position.Right} style={hidden} />
  </div>
);

const nodeTypes = { step: StepView };

const depthsOf = (diagram: Diagram): Map<string, number> => {
  const depths = new Map(diagram.nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < diagram.nodes.length; pass += 1) {
    for (const edge of diagram.edges) {
      depths.set(edge.to, Math.max(depths.get(edge.to) ?? 0, (depths.get(edge.from) ?? 0) + 1));
    }
  }
  return depths;
};

const buildGraph = (diagram: Diagram) => {
  const depths = depthsOf(diagram);
  const rows = new Map<number, number>();
  const nodes: DiagramNode[] = diagram.nodes.map((node) => {
    const depth = depths.get(node.id) ?? 0;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    return {
      id: node.id,
      type: "step",
      position: { x: depth * (NODE_WIDTH + COLUMN_GAP), y: row * ROW_GAP },
      data: { label: node.label, sub: node.sub, mode: node.mode },
      draggable: false,
    };
  });
  const edges: Edge[] = diagram.edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    type: "smoothstep",
    style: { stroke: "var(--blue-4)", strokeWidth: 1.5 },
    labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
  }));
  return { nodes, edges };
};

export const GrillDiagram = ({ diagram }: { diagram: Diagram }) => {
  const graph = useMemo(() => buildGraph(diagram), [diagram]);
  return (
    <div className="h-52 overflow-hidden rounded-lg border">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  );
};
