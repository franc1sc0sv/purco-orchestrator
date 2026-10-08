import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { cn } from "@/lib/utils";

export type DiagramMode = "new" | "changed" | "plain";

export type DiagramBox = { id: string; title: string; sub: string; mode: DiagramMode; row: number; col: number };
export type DiagramBand = { label: string; row: number };
export type DiagramLink = { from: string; to: string; label?: string; dashed?: boolean };

type BoxData = { title: string; sub: string; mode: DiagramMode };
type BandData = { label: string; width: number };

type BoxNode = Node<BoxData, "box">;
type BandNode = Node<BandData, "band">;

const ROW_HEIGHT = 150;
const COLUMN_WIDTH = 260;
const BOX_WIDTH = 220;
const BOX_HEIGHT = 62;
const BAND_GAP = 28;
const LEFT_PAD = 24;
const PAD_BOTTOM = 40;

const hidden = { opacity: 0, pointerEvents: "none" } as const;

const MODE_STYLE: Record<DiagramMode, string> = {
  new: "border-primary bg-blue-1 text-foreground border-2 border-dashed",
  changed: "border-primary bg-primary text-primary-foreground border-2",
  plain: "bg-muted text-muted-foreground border",
};

const BoxView = ({ data }: NodeProps<BoxNode>) => (
  <div
    className={cn("grid content-center rounded-lg px-3 py-2", MODE_STYLE[data.mode])}
    style={{ width: BOX_WIDTH, height: BOX_HEIGHT }}
  >
    <span className="truncate text-sm font-semibold" title={data.title}>
      {data.title}
    </span>
    <span className="truncate text-xs opacity-80" title={data.sub}>
      {data.sub}
    </span>
    <Handle type="target" position={Position.Top} style={hidden} />
    <Handle type="source" position={Position.Bottom} style={hidden} />
  </div>
);

const BandView = ({ data }: NodeProps<BandNode>) => (
  <div className="border-border border-b pb-1" style={{ width: data.width }}>
    <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{data.label}</span>
  </div>
);

const LabelledEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
}: EdgeProps) => {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const labelY = targetY - (targetY - sourceY) / 4;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="bg-card text-primary absolute rounded-md px-1.5 py-0.5 text-[11px]"
            style={{ transform: `translate(-50%, -50%) translate(${targetX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
};

const nodeTypes = { box: BoxView, band: BandView };
const edgeTypes = { labelled: LabelledEdge };

export const StoryDiagram = ({
  boxes,
  bands,
  links,
}: {
  boxes: DiagramBox[];
  bands: DiagramBand[];
  links: DiagramLink[];
}) => {
  const columns = Math.max(1, ...boxes.map((box) => box.col + 1));
  const width = columns * COLUMN_WIDTH + LEFT_PAD;
  const rows = Math.max(1, ...bands.map((band) => band.row + 1));
  const bandNodes = bands.map(
    (band): BandNode => ({
      id: `band:${band.row}`,
      type: "band",
      position: { x: 0, y: band.row * ROW_HEIGHT },
      data: { label: band.label, width },
      draggable: false,
      selectable: false,
    }),
  );
  const boxNodes = boxes.map(
    (box): BoxNode => ({
      id: box.id,
      type: "box",
      position: { x: LEFT_PAD + box.col * COLUMN_WIDTH, y: box.row * ROW_HEIGHT + BAND_GAP + 20 },
      data: { title: box.title, sub: box.sub, mode: box.mode },
      draggable: false,
    }),
  );
  const edges = links.map(
    (link): Edge => ({
      id: `${link.from}->${link.to}`,
      source: link.from,
      target: link.to,
      type: "labelled",
      label: link.label,
      style: { stroke: "var(--primary)", strokeWidth: 2, strokeDasharray: link.dashed ? "6 4" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--primary)" },
    }),
  );
  return (
    <div className="w-full" style={{ height: rows * ROW_HEIGHT + PAD_BOTTOM }}>
      <ReactFlow
        nodes={[...bandNodes, ...boxNodes]}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.02 }}
        minZoom={0.4}
        maxZoom={1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={28} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  );
};
