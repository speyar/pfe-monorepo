import type { SandboxManager } from "@packages/sandbox";

export interface GraphGeneratorOptions {
  rootPath: string;
  outPath: string;
  pretty?: boolean;
}

const GRAPH_CLI_URL =
  "https://github.com/speyar/pfe-monorepo/releases/download/v0.0.1/codebase-graph-cli.cjs";

async function runCmd(
  manager: SandboxManager,
  sandboxId: string,
  command: string,
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await manager.runCommand({
    sandboxId,
    command,
    args,
    cwd,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode ?? 0,
  };
}

export interface GraphGenerationResult {
  graphPath: string;
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  packageCount: number;
  elapsedMs: number;
}

export async function generateCodebaseGraph(
  manager: SandboxManager,
  sandboxId: string,
  options: GraphGeneratorOptions,
): Promise<GraphGenerationResult> {
  const startedAt = Date.now();

  console.log("[graph-generator] Downloading codebase-graph CLI...");
  const downloadResult = await runCmd(manager, sandboxId, "curl", [
    "-L",
    "-o",
    "/tmp/codebase-graph-cli.cjs",
    GRAPH_CLI_URL,
  ]);
  if (downloadResult.exitCode !== 0) {
    throw new Error(
      `Failed to download graph CLI: ${downloadResult.stderr || downloadResult.stdout}`,
    );
  }
  console.log("[graph-generator] CLI downloaded successfully.");

  const prettyFlag = options.pretty !== false ? "--pretty" : "";

  console.log("[graph-generator] Running codebase-graph on:", options.rootPath);
  const result = await runCmd(
    manager,
    sandboxId,
    "node",
    [
      "/tmp/codebase-graph-cli.cjs",
      "--root",
      options.rootPath,
      "--out",
      options.outPath,
      prettyFlag,
    ],
    options.rootPath,
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to generate codebase graph: ${result.stderr || result.stdout}`,
    );
  }

  console.log("[graph-generator] CLI stdout:", result.stdout.trim());
  if (result.stderr.trim()) {
    console.log("[graph-generator] CLI stderr:", result.stderr.trim());
  }

  console.log("[graph-generator] Reading graph metadata...");
  const catResult = await runCmd(manager, sandboxId, "cat", [options.outPath]);
  if (catResult.exitCode !== 0) {
    console.log(
      "[graph-generator] Could not read graph file for metadata logging.",
    );
  }

  let nodeCount = 0;
  let edgeCount = 0;
  let fileCount = 0;
  let packageCount = 0;

  if (catResult.exitCode === 0 && catResult.stdout) {
    try {
      const graphData = JSON.parse(catResult.stdout);
      nodeCount = graphData.metadata?.nodeCount ?? 0;
      edgeCount = graphData.metadata?.edgeCount ?? 0;
      fileCount = graphData.metadata?.fileCount ?? 0;
      packageCount = graphData.metadata?.packageCount ?? 0;
    } catch {
      console.log("[graph-generator] Could not parse graph JSON for metadata.");
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[graph-generator] Graph generated in ${elapsedMs}ms — packages=${packageCount}, files=${fileCount}, nodes=${nodeCount}, edges=${edgeCount}`,
  );

  return {
    graphPath: options.outPath,
    nodeCount,
    edgeCount,
    fileCount,
    packageCount,
    elapsedMs,
  };
}
