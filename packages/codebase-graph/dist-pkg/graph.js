export class CodebaseGraph {
    workspace;
    nodes = new Map();
    edges = new Map();
    outEdges = new Map();
    inEdges = new Map();
    nodesByKind = new Map();
    nodesByFile = new Map();
    nodesByName = new Map();
    constructor(workspace) {
        this.workspace = workspace;
    }
    getWorkspace() {
        return this.workspace;
    }
    addNode(node) {
        if (this.nodes.has(node.id)) {
            return;
        }
        this.nodes.set(node.id, node);
        const kindSet = this.nodesByKind.get(node.kind) ?? new Set();
        kindSet.add(node.id);
        this.nodesByKind.set(node.kind, kindSet);
        if (node.fileId) {
            const fileSet = this.nodesByFile.get(node.fileId) ?? new Set();
            fileSet.add(node.id);
            this.nodesByFile.set(node.fileId, fileSet);
        }
        const normalizedName = node.name.toLowerCase();
        const nameSet = this.nodesByName.get(normalizedName) ?? new Set();
        nameSet.add(node.id);
        this.nodesByName.set(normalizedName, nameSet);
    }
    addEdge(edge) {
        if (this.edges.has(edge.id)) {
            return;
        }
        this.edges.set(edge.id, edge);
        const outSet = this.outEdges.get(edge.from) ?? new Set();
        outSet.add(edge.id);
        this.outEdges.set(edge.from, outSet);
        const inSet = this.inEdges.get(edge.to) ?? new Set();
        inSet.add(edge.id);
        this.inEdges.set(edge.to, inSet);
    }
    getNode(nodeId) {
        return this.nodes.get(nodeId);
    }
    getEdge(edgeId) {
        return this.edges.get(edgeId);
    }
    getNodes() {
        return Array.from(this.nodes.values());
    }
    getEdges() {
        return Array.from(this.edges.values());
    }
    queryByType(type) {
        const ids = this.nodesByKind.get(type);
        if (!ids) {
            return [];
        }
        return Array.from(ids)
            .map((id) => this.nodes.get(id))
            .filter((node) => Boolean(node));
    }
    findCallersOf(functionId) {
        return this.findNeighborNodes(functionId, "in", (edge) => edge.kind === "calls");
    }
    findDependenciesOf(functionId) {
        return this.findNeighborNodes(functionId, "out", (edge) => edge.kind === "calls" ||
            edge.kind === "usesVariable" ||
            edge.kind === "typeReference");
    }
    findImpactOf(fileId) {
        const affectedFiles = new Set();
        const queue = [fileId];
        const visited = new Set(queue);
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
            .filter((node) => Boolean(node));
    }
    findPatternMatches(pattern) {
        return this.getNodes().filter((node) => {
            if (pattern.kind && node.kind !== pattern.kind) {
                return false;
            }
            if (pattern.nameIncludes &&
                !node.name.toLowerCase().includes(pattern.nameIncludes.toLowerCase())) {
                return false;
            }
            if (pattern.filePathIncludes &&
                !String(node.filePath ?? "")
                    .toLowerCase()
                    .includes(pattern.filePathIncludes.toLowerCase())) {
                return false;
            }
            return true;
        });
    }
    traceVariableUsage(variableName, scope) {
        const result = [];
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
            const incoming = this.inEdges.get(variableNode.id) ?? new Set();
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
    findUnusedFunctions() {
        const functionNodes = this.getNodes().filter((node) => node.kind === "function" || node.kind === "method");
        return functionNodes.filter((node) => {
            const incoming = this.inEdges.get(node.id) ?? new Set();
            const hasCallers = Array.from(incoming).some((edgeId) => {
                const edge = this.edges.get(edgeId);
                return edge?.kind === "calls";
            });
            return !hasCallers && !node.isExported;
        });
    }
    getDependencyChain(entityId, depth = 3) {
        const paths = [];
        const queue = [
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
                if (![
                    "imports",
                    "calls",
                    "usesVariable",
                    "typeReference",
                    "implements",
                    "extends",
                ].includes(edge.kind)) {
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
    findCrossPackageDependencies() {
        const result = [];
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
    toSnapshot() {
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
    findNeighborNodes(nodeId, direction, filter) {
        const edges = direction === "in" ? this.inEdges.get(nodeId) : this.outEdges.get(nodeId);
        if (!edges) {
            return [];
        }
        const neighbors = new Set();
        for (const edgeId of edges) {
            const edge = this.edges.get(edgeId);
            if (!edge || !filter(edge)) {
                continue;
            }
            neighbors.add(direction === "in" ? edge.from : edge.to);
        }
        return Array.from(neighbors)
            .map((id) => this.nodes.get(id))
            .filter((node) => Boolean(node));
    }
}
