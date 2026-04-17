import type {
  CodePattern,
  CrossPackageDependency,
  DependencyPath,
  EntityType,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  Scope,
  Usage,
  WorkspaceInfo,
} from "./types";

type EdgeFilter = (edge: GraphEdge) => boolean;

export class CodebaseGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly outEdges = new Map<string, Set<string>>();
  private readonly inEdges = new Map<string, Set<string>>();
  private readonly nodesByKind = new Map<GraphNode["kind"], Set<string>>();
  private readonly nodesByFile = new Map<string, Set<string>>();
  private readonly nodesByName = new Map<string, Set<string>>();

  public constructor(private readonly workspace: WorkspaceInfo) {}

  public getWorkspace(): WorkspaceInfo {
    return this.workspace;
  }

  public addNode(node: GraphNode): void {
    if (this.nodes.has(node.id)) {
      return;
    }

    this.nodes.set(node.id, node);

    const kindSet = this.nodesByKind.get(node.kind) ?? new Set<string>();
    kindSet.add(node.id);
    this.nodesByKind.set(node.kind, kindSet);

    if (node.fileId) {
      const fileSet = this.nodesByFile.get(node.fileId) ?? new Set<string>();
      fileSet.add(node.id);
      this.nodesByFile.set(node.fileId, fileSet);
    }

    const normalizedName = node.name.toLowerCase();
    const nameSet = this.nodesByName.get(normalizedName) ?? new Set<string>();
    nameSet.add(node.id);
    this.nodesByName.set(normalizedName, nameSet);
  }

  public addEdge(edge: GraphEdge): void {
    if (this.edges.has(edge.id)) {
      return;
    }

    this.edges.set(edge.id, edge);

    const outSet = this.outEdges.get(edge.from) ?? new Set<string>();
    outSet.add(edge.id);
    this.outEdges.set(edge.from, outSet);

    const inSet = this.inEdges.get(edge.to) ?? new Set<string>();
    inSet.add(edge.id);
    this.inEdges.set(edge.to, inSet);
  }

  public getNode(nodeId: string): GraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  public getEdge(edgeId: string): GraphEdge | undefined {
    return this.edges.get(edgeId);
  }

  public getNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  public getEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  public queryByType(type: EntityType): GraphNode[] {
    const ids = this.nodesByKind.get(type);
    if (!ids) {
      return [];
    }

    return Array.from(ids)
      .map((id) => this.nodes.get(id))
      .filter((node): node is GraphNode => Boolean(node));
  }

  public findCallersOf(functionId: string): GraphNode[] {
    return this.findNeighborNodes(
      functionId,
      "in",
      (edge) => edge.kind === "calls",
    );
  }

  public findDependenciesOf(functionId: string): GraphNode[] {
    return this.findNeighborNodes(
      functionId,
      "out",
      (edge) =>
        edge.kind === "calls" ||
        edge.kind === "usesVariable" ||
        edge.kind === "typeReference",
    );
  }

  public findImpactOf(fileId: string): GraphNode[] {
    const affectedFiles = new Set<string>();
    const queue = [fileId];
    const visited = new Set<string>(queue);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      const currentNode = this.nodes.get(current);
      if (currentNode?.kind === "file") {
        affectedFiles.add(current);
      }

      const incoming = this.inEdges.get(current);
      if (!incoming) {
        continue;
      }

      for (const edgeId of incoming) {
        const edge = this.edges.get(edgeId);
        if (!edge) {
          continue;
        }

        if (!["imports", "calls", "contains"].includes(edge.kind)) {
          continue;
        }

        if (visited.has(edge.from)) {
          continue;
        }

        visited.add(edge.from);
        queue.push(edge.from);

        const fromNode = this.nodes.get(edge.from);
        if (fromNode?.fileId && !visited.has(fromNode.fileId)) {
          visited.add(fromNode.fileId);
          queue.push(fromNode.fileId);
        }
      }
    }

    return Array.from(affectedFiles)
      .map((id) => this.nodes.get(id))
      .filter((node): node is GraphNode => Boolean(node));
  }

  public findPatternMatches(pattern: CodePattern): GraphNode[] {
    return this.getNodes().filter((node) => {
      if (pattern.kind && node.kind !== pattern.kind) {
        return false;
      }

      if (
        pattern.nameIncludes &&
        !node.name.toLowerCase().includes(pattern.nameIncludes.toLowerCase())
      ) {
        return false;
      }

      if (
        pattern.filePathIncludes &&
        !String(node.filePath ?? "")
          .toLowerCase()
          .includes(pattern.filePathIncludes.toLowerCase())
      ) {
        return false;
      }

      return true;
    });
  }

  public traceVariableUsage(variableName: string, scope: Scope): Usage[] {
    const result: Usage[] = [];
    const variableNodes = this.getNodes().filter((node) => {
      if (node.kind !== "variable") {
        return false;
      }

      if (node.name !== variableName) {
        return false;
      }

      if (scope.workspaceId && node.workspaceId !== scope.workspaceId) {
        return false;
      }

      if (scope.packageId && node.packageId !== scope.packageId) {
        return false;
      }

      if (scope.fileId && node.fileId !== scope.fileId) {
        return false;
      }

      return true;
    });

    for (const variableNode of variableNodes) {
      const incoming = this.inEdges.get(variableNode.id) ?? new Set<string>();
      for (const edgeId of incoming) {
        const edge = this.edges.get(edgeId);
        if (!edge || edge.kind !== "usesVariable") {
          continue;
        }

        result.push({
          nodeId: edge.from,
          variableId: variableNode.id,
          location: edge.location,
        });
      }
    }

    return result;
  }

  public findUnusedFunctions(): GraphNode[] {
    const functionNodes = this.getNodes().filter(
      (node) => node.kind === "function" || node.kind === "method",
    );

    return functionNodes.filter((node) => {
      const incoming = this.inEdges.get(node.id) ?? new Set<string>();
      const hasCallers = Array.from(incoming).some((edgeId) => {
        const edge = this.edges.get(edgeId);
        return edge?.kind === "calls";
      });

      return !hasCallers && !node.isExported;
    });
  }

  public getDependencyChain(entityId: string, depth = 3): DependencyPath[] {
    const paths: DependencyPath[] = [];
    const queue: Array<{
      nodeId: string;
      remainingDepth: number;
      path: DependencyPath;
    }> = [
      {
        nodeId: entityId,
        remainingDepth: depth,
        path: { nodes: [entityId], edges: [] },
      },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      if (current.remainingDepth <= 0) {
        paths.push(current.path);
        continue;
      }

      const outgoing = this.outEdges.get(current.nodeId);
      if (!outgoing || outgoing.size === 0) {
        paths.push(current.path);
        continue;
      }

      for (const edgeId of outgoing) {
        const edge = this.edges.get(edgeId);
        if (!edge) {
          continue;
        }

        if (
          ![
            "imports",
            "calls",
            "usesVariable",
            "typeReference",
            "implements",
            "extends",
          ].includes(edge.kind)
        ) {
          continue;
        }

        if (current.path.nodes.includes(edge.to)) {
          continue;
        }

        queue.push({
          nodeId: edge.to,
          remainingDepth: current.remainingDepth - 1,
          path: {
            nodes: [...current.path.nodes, edge.to],
            edges: [...current.path.edges, edge.id],
          },
        });
      }
    }

    return paths;
  }

  public findCrossPackageDependencies(): CrossPackageDependency[] {
    const result: CrossPackageDependency[] = [];

    for (const edge of this.getEdges()) {
      if (edge.kind !== "crossPackageDependency") {
        continue;
      }

      result.push({
        fromPackageId: edge.from,
        toPackageName: String(edge.metadata?.toPackageName ?? ""),
        viaFileId: String(edge.metadata?.viaFileId ?? ""),
        importPath: String(edge.metadata?.importPath ?? ""),
      });
    }

    return result;
  }

  public toSnapshot(): GraphSnapshot {
    const fileCount = this.queryByType("file").length;

    return {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      metadata: {
        workspace: this.workspace,
        packageCount: this.queryByType("package").length,
        fileCount,
        nodeCount: this.nodes.size,
        edgeCount: this.edges.size,
      },
      nodes: this.getNodes(),
      edges: this.getEdges(),
    };
  }

  private findNeighborNodes(
    nodeId: string,
    direction: "in" | "out",
    filter: EdgeFilter,
  ): GraphNode[] {
    const edges =
      direction === "in" ? this.inEdges.get(nodeId) : this.outEdges.get(nodeId);
    if (!edges) {
      return [];
    }

    const neighbors = new Set<string>();
    for (const edgeId of edges) {
      const edge = this.edges.get(edgeId);
      if (!edge || !filter(edge)) {
        continue;
      }

      neighbors.add(direction === "in" ? edge.from : edge.to);
    }

    return Array.from(neighbors)
      .map((id) => this.nodes.get(id))
      .filter((node): node is GraphNode => Boolean(node));
  }
}
