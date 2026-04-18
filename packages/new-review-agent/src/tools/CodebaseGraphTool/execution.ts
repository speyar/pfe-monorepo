import type { SandboxManager } from "@packages/sandbox";
import { logToolEvent, truncateByLines } from "../shared";
import type { CodebaseGraphInput } from "./input";

interface GraphNode {
  id: string;
  kind: string;
  name: string;
  workspaceId: string;
  packageId?: string;
  fileId?: string;
  filePath?: string;
  isExported?: boolean;
  signature?: string;
  returnType?: string;
  parameters?: Array<{ name: string; type: string }>;
  location?: {
    fileId: string;
    filePath: string;
    line: number;
    column: number;
  };
  metadata?: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  kind: string;
  from: string;
  to: string;
  workspaceId: string;
  packageId?: string;
  isCrossPackage?: boolean;
  isExternal?: boolean;
  location?: {
    fileId: string;
    filePath: string;
    line: number;
    column: number;
  };
  metadata?: Record<string, unknown>;
}

interface GraphSnapshot {
  metadata: {
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
    packageCount: number;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

let cachedGraph: GraphSnapshot | null = null;

async function loadGraph(
  manager: SandboxManager,
  sandboxId: string,
  graphPath: string,
): Promise<GraphSnapshot> {
  if (cachedGraph) {
    return cachedGraph;
  }

  logToolEvent({
    tool: "codebaseGraph",
    phase: "start",
    payload: { action: "loadGraph", path: graphPath },
  });

  const result = await manager.runCommand({
    sandboxId,
    command: "cat",
    args: [graphPath],
  });

  if (!result.stdout) {
    throw new Error(
      `Failed to read graph file: ${result.stderr || "empty output"}`,
    );
  }

  const graph = JSON.parse(result.stdout) as GraphSnapshot;
  cachedGraph = graph;

  logToolEvent({
    tool: "codebaseGraph",
    phase: "finish",
    payload: {
      action: "loadGraph",
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    },
  });

  return graph;
}

function findNodesByName(nodes: GraphNode[], name: string): GraphNode[] {
  const lower = name.toLowerCase();
  return nodes.filter((node) => node.name.toLowerCase().includes(lower));
}

function findNodesByFilePath(
  nodes: GraphNode[],
  filePath: string,
): GraphNode[] {
  const lower = filePath.toLowerCase();
  return nodes.filter(
    (node) =>
      node.filePath?.toLowerCase().endsWith(lower) ||
      node.filePath?.toLowerCase().includes(lower),
  );
}

function formatNode(node: GraphNode): string {
  const parts = [
    `${node.kind} "${node.name}"`,
    node.filePath ? `in ${node.filePath}` : "",
    node.location ? `:${node.location.line}` : "",
    node.isExported ? "(exported)" : "(not exported)",
  ];
  if (node.signature) {
    parts.push(`\n  signature: ${node.signature}`);
  }
  if (node.returnType) {
    parts.push(`\n  returns: ${node.returnType}`);
  }
  if (node.parameters && node.parameters.length > 0) {
    parts.push(
      `\n  params: ${node.parameters.map((p) => `${p.name}: ${p.type}`).join(", ")}`,
    );
  }
  return parts.filter(Boolean).join(" ");
}

function formatEdge(edge: GraphEdge, nodes: GraphNode[]): string {
  const fromNode = nodes.find((n) => n.id === edge.from);
  const toNode = nodes.find((n) => n.id === edge.to);
  const fromLabel = fromNode ? fromNode.name : edge.from;
  const toLabel = toNode ? toNode.name : edge.to;
  const cross = edge.isCrossPackage ? " [cross-package]" : "";
  const loc = edge.location
    ? ` at ${edge.location.filePath}:${edge.location.line}`
    : "";
  return `${fromLabel} --${edge.kind}--> ${toLabel}${cross}${loc}`;
}

function handleFindCallersOf(graph: GraphSnapshot, name: string): string {
  const matchingNodes = findNodesByName(graph.nodes, name);
  if (matchingNodes.length === 0) {
    return `No nodes found matching "${name}".`;
  }

  const targetIds = new Set(matchingNodes.map((n) => n.id));
  const callerEdges = graph.edges.filter(
    (edge) => targetIds.has(edge.to) && edge.kind === "calls",
  );

  if (callerEdges.length === 0) {
    return `No callers found for "${name}". The function may be unused or only called externally.`;
  }

  const lines: string[] = [
    `Callers of "${name}" (${callerEdges.length} call edges):`,
  ];
  for (const edge of callerEdges.slice(0, 50)) {
    const caller = graph.nodes.find((n) => n.id === edge.from);
    lines.push(
      `  - ${caller ? formatNode(caller) : edge.from} --calls--> "${name}"${edge.isCrossPackage ? " [cross-package]" : ""}`,
    );
  }
  if (callerEdges.length > 50) {
    lines.push(`  ... and ${callerEdges.length - 50} more`);
  }
  return lines.join("\n");
}

function handleFindDependenciesOf(graph: GraphSnapshot, name: string): string {
  const matchingNodes = findNodesByName(graph.nodes, name);
  if (matchingNodes.length === 0) {
    return `No nodes found matching "${name}".`;
  }

  const sourceIds = new Set(matchingNodes.map((n) => n.id));
  const depEdges = graph.edges.filter(
    (edge) =>
      sourceIds.has(edge.from) &&
      (edge.kind === "calls" ||
        edge.kind === "usesVariable" ||
        edge.kind === "typeReference"),
  );

  if (depEdges.length === 0) {
    return `No dependencies found for "${name}".`;
  }

  const lines: string[] = [
    `Dependencies of "${name}" (${depEdges.length} edges):`,
  ];
  for (const edge of depEdges.slice(0, 50)) {
    lines.push(`  - ${formatEdge(edge, graph.nodes)}`);
  }
  if (depEdges.length > 50) {
    lines.push(`  ... and ${depEdges.length - 50} more`);
  }
  return lines.join("\n");
}

function handleFindImpactOf(graph: GraphSnapshot, filePath: string): string {
  const fileNodes = findNodesByFilePath(graph.nodes, filePath);
  if (fileNodes.length === 0) {
    return `No file nodes found matching "${filePath}".`;
  }

  const fileIds = new Set(fileNodes.map((n) => n.id));
  const visited = new Set<string>(fileIds);
  const queue = [...fileIds];
  const impacted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = graph.nodes.find((n) => n.id === current);
    if (node?.kind === "file" && !fileIds.has(current)) {
      impacted.push(node.filePath ?? node.name);
    }

    const incoming = graph.edges.filter((e) => e.to === current);
    for (const edge of incoming) {
      if (
        visited.has(edge.from) ||
        !["imports", "calls", "contains"].includes(edge.kind)
      ) {
        continue;
      }
      visited.add(edge.from);
      queue.push(edge.from);
      const fromNode = graph.nodes.find((n) => n.id === edge.from);
      if (fromNode?.fileId && !visited.has(fromNode.fileId)) {
        visited.add(fromNode.fileId);
        queue.push(fromNode.fileId);
      }
    }
  }

  if (impacted.length === 0) {
    return `No other files impacted by changes to "${filePath}".`;
  }

  return `Files impacted by changes to "${filePath}" (${impacted.length}):\n${impacted.map((f) => `  - ${f}`).join("\n")}`;
}

function handleFindUnusedFunctions(graph: GraphSnapshot): string {
  const functionNodes = graph.nodes.filter(
    (node) => node.kind === "function" || node.kind === "method",
  );

  const calledIds = new Set(
    graph.edges.filter((edge) => edge.kind === "calls").map((edge) => edge.to),
  );

  const unused = functionNodes.filter(
    (node) => !calledIds.has(node.id) && !node.isExported,
  );

  if (unused.length === 0) {
    return "No unused functions found.";
  }

  return `Unused functions (not called, not exported) (${unused.length}):\n${unused
    .slice(0, 50)
    .map((n) => `  - ${formatNode(n)}`)
    .join("\n")}${
    unused.length > 50 ? `\n  ... and ${unused.length - 50} more` : ""
  }`;
}

function handleGetChangedFileNodes(
  graph: GraphSnapshot,
  changedFiles: string[],
): string {
  const allMatches: string[] = [];

  for (const filePath of changedFiles) {
    const fileNodes = findNodesByFilePath(graph.nodes, filePath);
    if (fileNodes.length === 0) {
      continue;
    }

    const fileNode = fileNodes.find((n) => n.kind === "file");
    const contained = graph.nodes.filter(
      (n) =>
        n.fileId === fileNode?.id ||
        (n.filePath &&
          findNodesByFilePath(graph.nodes, filePath).some(
            (fn) => fn.id === n.fileId,
          )),
    );

    allMatches.push(
      `\n--- ${filePath} ---\n${contained
        .filter((n) => n.kind !== "file")
        .slice(0, 30)
        .map((n) => `  ${formatNode(n)}`)
        .join("\n")}`,
    );
  }

  if (allMatches.length === 0) {
    return `No graph nodes found for the given changed files.`;
  }

  return `Nodes in changed files:\n${allMatches.join("\n")}`;
}

function handleGetNodesByName(graph: GraphSnapshot, name: string): string {
  const nodes = findNodesByName(graph.nodes, name);
  if (nodes.length === 0) {
    return `No nodes found matching "${name}".`;
  }

  return `Nodes matching "${name}" (${nodes.length}):\n${nodes
    .slice(0, 30)
    .map((n) => `  - ${formatNode(n)}`)
    .join("\n")}${
    nodes.length > 30 ? `\n  ... and ${nodes.length - 30} more` : ""
  }`;
}

function handleGetCrossPackageDeps(graph: GraphSnapshot): string {
  const crossDeps = graph.edges.filter(
    (edge) => edge.kind === "crossPackageDependency" || edge.isCrossPackage,
  );

  if (crossDeps.length === 0) {
    return "No cross-package dependencies found.";
  }

  return `Cross-package dependencies (${crossDeps.length}):\n${crossDeps
    .slice(0, 50)
    .map((e) => `  ${formatEdge(e, graph.nodes)}`)
    .join("\n")}${
    crossDeps.length > 50 ? `\n  ... and ${crossDeps.length - 50} more` : ""
  }`;
}

function handleGetNodeDetails(graph: GraphSnapshot, nodeId: string): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return `Node not found: "${nodeId}". Use getNodesByName to search by name.`;
  }

  const incoming = graph.edges.filter((e) => e.to === node.id);
  const outgoing = graph.edges.filter((e) => e.from === node.id);

  const details: string[] = [
    `Node: ${formatNode(node)}`,
    `ID: ${node.id}`,
    `Kind: ${node.kind}`,
  ];

  if (node.packageId) {
    details.push(`Package: ${node.packageId}`);
  }

  if (incoming.length > 0) {
    details.push(
      `\nIncoming edges (${incoming.length}):`,
      ...incoming.slice(0, 20).map((e) => `  ${formatEdge(e, graph.nodes)}`),
    );
  }

  if (outgoing.length > 0) {
    details.push(
      `\nOutgoing edges (${outgoing.length}):`,
      ...outgoing.slice(0, 20).map((e) => `  ${formatEdge(e, graph.nodes)}`),
    );
  }

  return details.join("\n");
}

export function createCodebaseGraphExecutor(
  manager: SandboxManager,
  sandboxId: string,
  graphPath: string,
) {
  return async (input: CodebaseGraphInput): Promise<string> => {
    logToolEvent({
      tool: "codebaseGraph",
      phase: "start",
      payload: input,
    });

    const startedAt = Date.now();

    try {
      const graph = await loadGraph(manager, sandboxId, graphPath);
      let result: string;

      switch (input.query) {
        case "findCallersOf": {
          if (!input.name) {
            result = "Error: name parameter is required for findCallersOf.";
            break;
          }
          result = handleFindCallersOf(graph, input.name);
          break;
        }
        case "findDependenciesOf": {
          if (!input.name) {
            result =
              "Error: name parameter is required for findDependenciesOf.";
            break;
          }
          result = handleFindDependenciesOf(graph, input.name);
          break;
        }
        case "findImpactOf": {
          if (!input.filePath) {
            result = "Error: filePath parameter is required for findImpactOf.";
            break;
          }
          result = handleFindImpactOf(graph, input.filePath);
          break;
        }
        case "findUnusedFunctions": {
          result = handleFindUnusedFunctions(graph);
          break;
        }
        case "getChangedFileNodes": {
          const files = input.changedFiles ?? [];
          if (files.length === 0) {
            result =
              "Error: changedFiles parameter is required for getChangedFileNodes.";
            break;
          }
          result = handleGetChangedFileNodes(graph, files);
          break;
        }
        case "getNodesByName": {
          if (!input.name) {
            result = "Error: name parameter is required for getNodesByName.";
            break;
          }
          result = handleGetNodesByName(graph, input.name);
          break;
        }
        case "getCrossPackageDeps": {
          result = handleGetCrossPackageDeps(graph);
          break;
        }
        case "getNodeDetails": {
          if (!input.nodeId) {
            result = "Error: nodeId parameter is required for getNodeDetails.";
            break;
          }
          result = handleGetNodeDetails(graph, input.nodeId);
          break;
        }
        default:
          result = `Unknown query type: ${input.query}`;
      }

      const elapsedMs = Date.now() - startedAt;
      const truncated = truncateByLines(result, 300);

      logToolEvent({
        tool: "codebaseGraph",
        phase: "finish",
        payload: {
          query: input.query,
          name: input.name,
          filePath: input.filePath,
          elapsedMs,
          resultLength: result.length,
          truncated: result.length > truncated.length,
        },
      });

      console.log(
        `[codebaseGraph] query=${input.query} name=${input.name ?? ""} filePath=${input.filePath ?? ""} elapsedMs=${elapsedMs} resultChars=${result.length}`,
      );

      return truncated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(
        `[codebaseGraph] ERROR query=${input.query} error=${message}`,
      );
      return `Error querying codebase graph: ${message}`;
    }
  };
}
