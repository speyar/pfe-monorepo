"use client";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  ReactFlowProvider,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  GraphViewNode,
  GraphViewEdge,
  nodeKindToColor,
  nodeKindToLabel,
} from "@/lib/graph-adapter";

interface GraphViewerProps {
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  onNodeClick?: (nodeId: string) => void;
}

function GraphViewerInner({ nodes, edges, onNodeClick }: GraphViewerProps) {
  const initialNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: "custom",
        position: n.position,
        data: { ...n.data },
        style: n.style,
      })),
    [nodes],
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type === "calls" ? "animated" : "default",
        animated: e.animated,
        label: e.label,
        style: e.style,
      })),
    [edges],
  );

  const [flowNodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClickHandler = useCallback(
    (event: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  const nodeTypes = useMemo(
    () => ({
      custom: ({ data }: { data: Record<string, unknown> }) => {
        const kind = (data.kind as string) ?? "file";
        const label = (data.label as string) ?? "";
        const color = nodeKindToColor(kind as never);

        return (
          <div
            style={{
              background: color,
              border: "1px solid rgba(0,0,0,0.1)",
              borderRadius: "6px",
              padding: "8px 12px",
              color: "white",
              fontSize: "12px",
              fontWeight: 500,
              minWidth: "100px",
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "2px" }}>
              {nodeKindToLabel(kind as never)}
            </div>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {label}
            </div>
          </div>
        );
      },
    }),
    [],
  );

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">No nodes to display</p>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "600px" }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClickHandler}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(node) => nodeKindToColor(node.type as string as never)}
          maskColor="rgb(243, 244, 246, 0.8)"
        />
        <Panel position="top-right">
          <div className="bg-background border rounded-lg p-3 shadow-md">
            <div className="text-sm font-semibold mb-2">Legend</div>
            <div className="flex flex-wrap gap-2">
              {[
                "workspace",
                "package",
                "file",
                "function",
                "class",
                "interface",
                "variable",
              ].map((kind) => (
                <div key={kind} className="flex items-center gap-1">
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "2px",
                      background: nodeKindToColor(kind as never),
                    }}
                  />
                  <span className="text-xs">
                    {nodeKindToLabel(kind as never)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export default function GraphViewer(props: GraphViewerProps) {
  return (
    <ReactFlowProvider>
      <GraphViewerInner {...props} />
    </ReactFlowProvider>
  );
}
