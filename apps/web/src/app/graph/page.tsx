import { readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

import GraphViewer from "@/components/graph/graph-viewer";
import { GraphSnapshot } from "@/lib/graph-types";
import {
  buildGraphViewNodes,
  buildGraphViewEdges,
  buildIndexes,
  getNodeDependencies,
  getNodeConsumers,
} from "@/lib/graph-adapter";

async function loadGraph(): Promise<GraphSnapshot | null> {
  try {
    const graphPath = join(
      process.cwd(),
      "..",
      "..",
      "graph-output",
      "codebase-graph.json",
    );
    const content = await readFile(graphPath, "utf-8");
    return JSON.parse(content) as GraphSnapshot;
  } catch {
    return null;
  }
}

export default async function GraphPage() {
  const snapshot = await loadGraph();

  if (!snapshot) {
    return (
      <div className="container mx-auto mt-8 px-4">
        <h1 className="text-3xl font-bold mb-4">Codebase Graph</h1>
        <p className="text-muted-foreground">
          No graph data found. Run the graph generator first.
        </p>
      </div>
    );
  }

  const nodes = buildGraphViewNodes(snapshot);
  const edges = buildGraphViewEdges(snapshot);
  const indexes = buildIndexes(snapshot);

  // Sample subgraph - first function or method node
  const sampleNode = snapshot.nodes.find(
    (n) => n.kind === "function" || n.kind === "method",
  );

  let viewNodes = nodes;
  let viewEdges = edges;

  if (sampleNode) {
    // Simple grid positioning for now
    viewNodes = viewNodes.map((n: (typeof nodes)[number], i: number) => ({
      ...n,
      position: {
        x: (i % 10) * 150,
        y: Math.floor(i / 10) * 80,
      },
    }));
  }

  const initialNodeId = sampleNode?.id ?? "";

  const nodeInfo = initialNodeId
    ? {
        node: snapshot.nodes.find(
          (n: GraphSnapshot["nodes"][number]) => n.id === initialNodeId,
        ),
        dependencies: getNodeDependencies(initialNodeId, indexes),
        consumers: getNodeConsumers(initialNodeId, indexes),
      }
    : null;

  return (
    <div className="container mx-auto mt-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Codebase Graph</h1>
          <p className="text-muted-foreground">
            {snapshot.nodes.length} nodes, {snapshot.edges.length} edges
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          <GraphViewer nodes={viewNodes} edges={viewEdges} />
        </div>

        <div className="lg:col-span-1">
          {nodeInfo?.node && (
            <div className="bg-card border rounded-lg p-4 shadow-sm">
              <h2 className="text-lg font-semibold mb-3">Node Details</h2>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-muted-foreground">Name</div>
                  <div className="font-medium">{nodeInfo.node.name}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Kind</div>
                  <div className="font-medium">{nodeInfo.node.kind}</div>
                </div>
                {nodeInfo.node.fileId && (
                  <div>
                    <div className="text-sm text-muted-foreground">File</div>
                    <div className="font-medium text-xs">
                      {nodeInfo.node.fileId}
                    </div>
                  </div>
                )}
                {nodeInfo.dependencies.callees.length > 0 && (
                  <div>
                    <div className="text-sm text-muted-foreground">
                      Calls ({nodeInfo.dependencies.callees.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {nodeInfo.dependencies.callees.slice(0, 5).map((n) => (
                        <span
                          key={n.id}
                          className="bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded"
                        >
                          {n.name}
                        </span>
                      ))}
                      {nodeInfo.dependencies.callees.length > 5 && (
                        <span className="text-xs text-muted-foreground">
                          +{nodeInfo.dependencies.callees.length - 5}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {nodeInfo.dependencies.variablesUsed.length > 0 && (
                  <div>
                    <div className="text-sm text-muted-foreground">
                      Uses ({nodeInfo.dependencies.variablesUsed.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {nodeInfo.dependencies.variablesUsed
                        .slice(0, 5)
                        .map((n) => (
                          <span
                            key={n.id}
                            className="bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded"
                          >
                            {n.name}
                          </span>
                        ))}
                    </div>
                  </div>
                )}
                {nodeInfo.consumers.callers.length > 0 && (
                  <div>
                    <div className="text-sm text-muted-foreground">
                      Called by ({nodeInfo.consumers.callers.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {nodeInfo.consumers.callers.slice(0, 5).map((n) => (
                        <span
                          key={n.id}
                          className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded"
                        >
                          {n.name}
                        </span>
                      ))}
                      {nodeInfo.consumers.callers.length > 5 && (
                        <span className="text-xs text-muted-foreground">
                          +{nodeInfo.consumers.callers.length - 5}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
