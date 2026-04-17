import type {
  GraphSnapshot,
  GraphNode,
  GraphEdge,
  NodeKind,
} from "./graph-types";

export interface GraphViewNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: GraphNodeData;
  style?: React.CSSProperties;
  selected?: boolean;
}

export interface GraphViewEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
  label?: string;
  style?: React.CSSProperties;
  data?: GraphEdge;
}

export interface GraphNodeData extends GraphNode {
  label: string;
}

export interface GraphEdgeData extends GraphEdge {
  animated?: boolean;
  label?: string;
}

const NODE_KIND_COLORS: Record<NodeKind, string> = {
  workspace: "#6366f1",
  package: "#8b5cf6",
  file: "#3b82f6",
  function: "#22c55e",
  method: "#16a34a",
  class: "#f59e0b",
  interface: "#64748b",
  typeAlias: "#94a3b8",
  variable: "#eab308",
};

export function nodeKindToColor(kind: NodeKind): string {
  return NODE_KIND_COLORS[kind] ?? "#94a3b8";
}

export function nodeKindToLabel(kind: NodeKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function buildGraphViewNodes(snapshot: GraphSnapshot): GraphViewNode[] {
  return snapshot.nodes.map((node: GraphNode): GraphViewNode => {
    return {
      id: node.id,
      type: node.kind,
      position: { x: 0, y: 0 },
      data: {
        ...node,
        label: node.name,
      },
      style: {
        background: nodeKindToColor(node.kind),
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: "6px",
        padding: "8px 12px",
        color: "white",
        fontSize: "12px",
        fontWeight: 500,
      },
    };
  });
}

export function buildGraphViewEdges(snapshot: GraphSnapshot): GraphViewEdge[] {
  return snapshot.edges.map((edge: GraphEdge): GraphViewEdge => {
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: edge.kind,
      animated: edge.kind === "calls",
      label: edge.kind,
      style: {
        stroke: getEdgeColor(edge.kind),
        strokeWidth: edge.kind === "calls" ? 2 : 1,
      },
      data: edge,
    };
  });
}

function getEdgeColor(kind: string): string {
  switch (kind) {
    case "calls":
      return "#22c55e";
    case "contains":
      return "#94a3b8";
    case "imports":
      return "#3b82f6";
    case "usesVariable":
      return "#eab308";
    case "typeReference":
      return "#64748b";
    case "extends":
    case "implements":
      return "#f59e0b";
    case "crossPackageDependency":
      return "#8b5cf6";
    default:
      return "#94a3b8";
  }
}

export interface GraphIndexes {
  nodesById: Map<string, GraphNode>;
  edgesById: Map<string, GraphEdge>;
  outEdgesByNode: Map<string, GraphEdge[]>;
  inEdgesByNode: Map<string, GraphEdge[]>;
  nodesByFile: Map<string, GraphNode[]>;
  nodesByKind: Map<NodeKind, GraphNode[]>;
}

export function buildIndexes(snapshot: GraphSnapshot): GraphIndexes {
  const nodesById = new Map<string, GraphNode>();
  const edgesById = new Map<string, GraphEdge>();
  const outEdgesByNode = new Map<string, GraphEdge[]>();
  const inEdgesByNode = new Map<string, GraphEdge[]>();
  const nodesByFile = new Map<string, GraphNode[]>();
  const nodesByKind = new Map<NodeKind, GraphNode[]>();

  for (const node of snapshot.nodes) {
    nodesById.set(node.id, node);

    const byFile = nodesByFile.get(node.fileId ?? "") ?? [];
    if (node.fileId) {
      byFile.push(node);
      nodesByFile.set(node.fileId, byFile);
    }

    const byKind = nodesByKind.get(node.kind) ?? [];
    byKind.push(node);
    nodesByKind.set(node.kind, byKind);
  }

  for (const edge of snapshot.edges) {
    edgesById.set(edge.id, edge);

    const out = outEdgesByNode.get(edge.from) ?? [];
    out.push(edge);
    outEdgesByNode.set(edge.from, out);

    const in_ = inEdgesByNode.get(edge.to) ?? [];
    in_.push(edge);
    inEdgesByNode.set(edge.to, in_);
  }

  return {
    nodesById,
    edgesById,
    outEdgesByNode,
    inEdgesByNode,
    nodesByFile,
    nodesByKind,
  };
}

export interface NodeDependencies {
  callees: GraphNode[];
  variablesUsed: GraphNode[];
  typesReferenced: GraphNode[];
}

export interface NodeConsumers {
  callers: GraphNode[];
}

export function getNodeDependencies(
  nodeId: string,
  indexes: GraphIndexes,
): NodeDependencies {
  const outEdges = indexes.outEdgesByNode.get(nodeId) ?? [];
  const callees: GraphNode[] = [];
  const variablesUsed: GraphNode[] = [];
  const typesReferenced: GraphNode[] = [];

  for (const edge of outEdges) {
    if (edge.kind === "calls") {
      const target = indexes.nodesById.get(edge.to);
      if (target) callees.push(target);
    } else if (edge.kind === "usesVariable") {
      const target = indexes.nodesById.get(edge.to);
      if (target) variablesUsed.push(target);
    } else if (edge.kind === "typeReference") {
      const target = indexes.nodesById.get(edge.to);
      if (target) typesReferenced.push(target);
    }
  }

  return { callees, variablesUsed, typesReferenced };
}

export function getNodeConsumers(
  nodeId: string,
  indexes: GraphIndexes,
): NodeConsumers {
  const inEdges = indexes.inEdgesByNode.get(nodeId) ?? [];
  const callers: GraphNode[] = [];

  for (const edge of inEdges) {
    if (edge.kind === "calls") {
      const source = indexes.nodesById.get(edge.from);
      if (source) callers.push(source);
    }
  }

  return { callers };
}

export interface SubgraphViewOptions {
  centerNodeId: string;
  depth: number;
  edgeKinds?: string[];
}

export function buildSubgraphView(
  snapshot: GraphSnapshot,
  options: SubgraphViewOptions,
): { nodes: GraphViewNode[]; edges: GraphViewEdge[] } {
  const indexes = buildIndexes(snapshot);
  const { centerNodeId, depth, edgeKinds } = options;
  const allowedKinds = edgeKinds ?? [
    "calls",
    "usesVariable",
    "typeReference",
    "contains",
    "imports",
  ];

  const visited = new Set<string>();
  const nodeIds = new Set<string>([centerNodeId]);
  const edgeIds = new Set<string>();

  const queue: Array<{ id: string; currentDepth: number }> = [
    { id: centerNodeId, currentDepth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (current.currentDepth >= depth) continue;

    const outEdges = indexes.outEdgesByNode.get(current.id) ?? [];
    const inEdges = indexes.inEdgesByNode.get(current.id) ?? [];

    for (const edge of [...outEdges, ...inEdges]) {
      if (!allowedKinds.includes(edge.kind)) continue;
      if (edgeIds.has(edge.id)) continue;

      edgeIds.add(edge.id);

      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        nodeIds.add(edge.to);
        queue.push({ id: edge.to, currentDepth: current.currentDepth + 1 });
      }

      if (!visited.has(edge.from)) {
        visited.add(edge.from);
        nodeIds.add(edge.from);
        queue.push({ id: edge.from, currentDepth: current.currentDepth + 1 });
      }
    }
  }

  const viewNodes: GraphViewNode[] = [];
  const viewEdges: GraphViewEdge[] = [];

  for (const nodeId of nodeIds) {
    const node = indexes.nodesById.get(nodeId);
    if (!node) continue;

    viewNodes.push({
      id: node.id,
      type: node.kind,
      position: { x: 0, y: 0 },
      data: { ...node, label: node.name },
      style: {
        background: nodeKindToColor(node.kind),
        border:
          nodeId === centerNodeId
            ? "2px solid #ef4444"
            : "1px solid rgba(0,0,0,0.1)",
        borderRadius: "6px",
        padding: "8px 12px",
        color: "white",
        fontSize: "12px",
        fontWeight: nodeId === centerNodeId ? 700 : 500,
      },
    });
  }

  for (const edgeId of edgeIds) {
    const edge = indexes.edgesById.get(edgeId);
    if (!edge) continue;

    viewEdges.push({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: edge.kind,
      animated: edge.kind === "calls",
      style: {
        stroke: getEdgeColor(edge.kind),
        strokeWidth: edge.kind === "calls" ? 2 : 1,
      },
      data: edge,
    });
  }

  return { nodes: viewNodes, edges: viewEdges };
}
