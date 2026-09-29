import type {
  ClosureEdge,
  ClosureNode,
  EdgeKind,
  NodeKind,
} from "test-forge-contracts/closure";

export type ClosureGraph = {
  nodes: Map<string, ClosureNode>;
  edges: ClosureEdge[];
};

export type NodeDraft = {
  kind: NodeKind;
  path: string;
  reachedVia: string;
  hops: number;
  symbol?: string;
};

export type NodeAddition = {
  node: ClosureNode;
  added: boolean;
};

export type EdgeReach = "transitive" | "one-hop";

export type ClosureCounts = {
  nodes: number;
  edges: number;
  byKind: Partial<Record<NodeKind, number>>;
  maxHops: number;
};

export const EDGE_REACH: Record<EdgeKind, EdgeReach> = {
  caller: "one-hop",
  "mutation-consumer": "one-hop",
  external: "one-hop",
  router: "one-hop",
  hook: "one-hop",
  route: "one-hop",
  "event-handler": "transitive",
  "shared-caller": "transitive",
  component: "transitive",
};

export const isTransitiveEdge = (kind: EdgeKind): boolean =>
  EDGE_REACH[kind] === "transitive";

export const emptyGraph = (): ClosureGraph => ({ nodes: new Map(), edges: [] });

export const nodeId = (kind: NodeKind, ref: string): string => `${kind}:${ref}`;

export const kindPrefixOf = (id: string): string => id.split(":")[0] ?? id;

export const makeNode = (draft: NodeDraft): ClosureNode => ({
  id: nodeId(draft.kind, draft.path),
  kind: draft.kind,
  path: draft.path,
  reachedVia: draft.reachedVia,
  hops: draft.hops,
  ...(draft.symbol === undefined ? {} : { symbol: draft.symbol }),
});

export const addNode = (
  graph: ClosureGraph,
  draft: NodeDraft
): NodeAddition => {
  const node = makeNode(draft);
  const existing = graph.nodes.get(node.id);
  if (existing !== undefined) return { node: existing, added: false };
  graph.nodes.set(node.id, node);
  return { node, added: true };
};

export const addEdge = (graph: ClosureGraph, edge: ClosureEdge): void => {
  graph.edges.push(edge);
};

export const nextHop = (hops: number): number => hops + 1;

export const nodeList = (graph: ClosureGraph): ClosureNode[] => [
  ...graph.nodes.values(),
];

export const maxHops = (nodes: readonly ClosureNode[]): number =>
  nodes.reduce((highest, node) => Math.max(highest, node.hops), 0);

export const countByKind = (
  nodes: readonly ClosureNode[]
): Partial<Record<NodeKind, number>> => {
  const counts: Partial<Record<NodeKind, number>> = {};
  for (const node of nodes) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  return counts;
};

export const summarize = (graph: ClosureGraph): ClosureCounts => {
  const nodes = nodeList(graph);
  return {
    nodes: nodes.length,
    edges: graph.edges.length,
    byKind: countByKind(nodes),
    maxHops: maxHops(nodes),
  };
};
