import type { LanguageModel } from "ai";
import type { ReviewFinding } from "./schema/review-result";
import { runSubReview, type SubReviewResult } from "./sub-review";
import type { SandboxManager } from "@packages/sandbox";
import type { DependencyNode, DependencyEdge } from "./v2/types";

export interface FanOutReviewInput {
  model: LanguageModel;
  files: Array<{ path: string; patch: string }>;
  batchSize?: number;
  maxBatches?: number;
  sandboxManager?: SandboxManager;
  sandboxId?: string;
  graphPath?: string;
  dependencyNodes?: DependencyNode[];
  dependencyEdges?: DependencyEdge[];
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function clusterByDependencies(
  files: Array<{ path: string; patch: string }>,
  dependencyNodes: DependencyNode[],
  dependencyEdges: DependencyEdge[],
  maxBatchSize: number,
): Array<{ path: string; patch: string }>[] {
  const pathToNode = new Map(dependencyNodes.map((n) => [n.path, n]));

  const adjacency: Map<string, Set<string>> = new Map();
  for (const f of files) {
    adjacency.set(f.path, new Set());
  }

  for (const edge of dependencyEdges) {
    if (edge.kind === "import") {
      const sourceFiles = dependencyNodes
        .filter((n) => n.imports.includes(edge.to))
        .map((n) => n.path);
      for (const src of sourceFiles) {
        if (adjacency.has(src) && adjacency.has(edge.from)) {
          adjacency.get(src)?.add(edge.from);
          adjacency.get(edge.from)?.add(src);
        }
      }
    }
  }

  for (const node of dependencyNodes) {
    for (const imp of node.imports) {
      for (const other of dependencyNodes) {
        if (other.path !== node.path && other.imports.includes(imp)) {
          if (adjacency.has(node.path) && adjacency.has(other.path)) {
            adjacency.get(node.path)?.add(other.path);
            adjacency.get(other.path)?.add(node.path);
          }
        }
      }
    }
  }

  const filePaths = files.map((f) => f.path);
  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const fp of filePaths) {
    if (visited.has(fp)) continue;

    const cluster: string[] = [];
    const queue = [fp];
    visited.add(fp);

    while (queue.length > 0) {
      const current = queue.shift()!;
      cluster.push(current);

      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor) && filePaths.includes(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    clusters.push(cluster);
  }

  const unclustered = filePaths.filter((fp) => !visited.has(fp));
  clusters.push(...unclustered.map((fp) => [fp]));

  const batches: string[][] = [];
  let currentBatch: string[] = [];

  for (const cluster of clusters) {
    if (
      currentBatch.length > 0 &&
      currentBatch.length + cluster.length > maxBatchSize
    ) {
      batches.push(currentBatch);
      currentBatch = [];
    }

    if (cluster.length > maxBatchSize) {
      for (let i = 0; i < cluster.length; i += maxBatchSize) {
        batches.push(cluster.slice(i, i + maxBatchSize));
      }
    } else {
      currentBatch.push(...cluster);
      if (currentBatch.length >= maxBatchSize) {
        batches.push(currentBatch);
        currentBatch = [];
      }
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  const pathToFile = new Map(files.map((f) => [f.path, f]));
  return batches.map((batch) =>
    batch.map((p) => pathToFile.get(p)!).filter(Boolean),
  );
}

export async function runSubReviews(
  input: FanOutReviewInput,
): Promise<SubReviewResult[]> {
  const batchSize = input.batchSize ?? 15;
  const maxBatches = input.maxBatches ?? 5;

  let batches: Array<Array<{ path: string; patch: string }>>;

  if (input.dependencyNodes && input.dependencyNodes.length > 0) {
    console.log(
      `[fan-out] Using dependency-aware clustering with ${input.dependencyNodes.length} nodes, ${(input.dependencyEdges ?? []).length} edges`,
    );
    const depEdges = input.dependencyEdges ?? [];
    batches = clusterByDependencies(
      input.files,
      input.dependencyNodes,
      depEdges,
      batchSize,
    );
    console.log(
      `[fan-out] Dependency clustering produced ${batches.length} batches (vs ${Math.ceil(input.files.length / batchSize)} naive)`,
    );
  } else {
    console.log(
      "[fan-out] No dependency data available, using size-based chunking",
    );
    const chunks = chunkArray(input.files, batchSize);
    batches = chunks.slice(0, maxBatches);
  }

  const totalBatches = Math.min(batches.length, maxBatches);
  batches = batches.slice(0, maxBatches);

  const allPaths = input.files.map((f) => f.path);

  console.log(
    `[fan-out] starting: ${input.files.length} files, ${totalBatches} batches of ~${batchSize}`,
  );

  const batchInputs = batches.map((batch, i) => ({
    model: input.model,
    files: batch,
    batchName: `${i + 1}/${totalBatches}`,
    batchIndex: i + 1,
    totalBatches,
    allChangedFiles: allPaths,
    sandboxManager: input.sandboxManager,
    sandboxId: input.sandboxId,
    graphPath: input.graphPath,
    dependencyNodes: input.dependencyNodes,
  }));

  const startedAt = Date.now();
  const results = await Promise.all(
    batchInputs.map((bi) => runSubReview(bi)),
  );
  const totalElapsed = Date.now() - startedAt;

  const successCount = results.filter((r) => !r.error).length;
  const failCount = results.filter((r) => r.error).length;
  const totalFindings = results.reduce(
    (sum, r) => sum + r.findings.length,
    0,
  );

  console.log(
    `[fan-out] all batches done in ${totalElapsed}ms — ${successCount} succeeded, ${failCount} failed, ${totalFindings} total findings`,
  );
  results.forEach((r) => {
    console.log(
      `[fan-out] batch ${r.batchName}: ${r.findings.length} findings${r.error ? ` ERROR: ${r.error}` : ""}`,
    );
  });

  return results;
}

export function mergeSubFindings(
  results: SubReviewResult[],
): ReviewFinding[] {
  const merged = results.flatMap((r) => r.findings);
  console.log(
    `[fan-out] merged ${merged.length} findings from ${results.length} batches`,
  );
  return merged;
}

export function buildSubFindingsPrompt(
  findings: ReviewFinding[],
): string {
  if (findings.length === 0) {
    return "No findings were reported by sub-agents.";
  }

  console.log(
    `[fan-out] building main agent prompt with ${findings.length} sub-agent findings`,
  );

  const lines: string[] = [
    `Sub-agents reported ${findings.length} findings across all batches.`,
    "",
    "Your job: validate each finding against the actual codebase using readFile/grep/codebaseGraph.",
    "Cross-reference across files, deduplicate, adjust severity if needed.",
    "Add any new findings the sub-agents missed.",
    "",
    "Reported findings:",
  ];

  findings.forEach((f, i) => {
    const loc = f.file
      ? `${f.file}${f.line ? `:${f.line}` : ""}`
      : "unknown";
    lines.push(
      `  ${i + 1}. [${f.severity}] ${loc} — ${f.title}`,
    );
    if (f.message) {
      lines.push(`     ${f.message.slice(0, 200)}`);
    }
  });

  return lines.join("\n");
}
