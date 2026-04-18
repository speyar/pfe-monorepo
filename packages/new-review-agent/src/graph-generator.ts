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

export async function generateCodebaseGraph(
  manager: SandboxManager,
  sandboxId: string,
  options: GraphGeneratorOptions,
): Promise<void> {
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

  const prettyFlag = options.pretty !== false ? "--pretty" : "";

  console.log("[graph-generator] Running codebase-graph...");
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

  console.log("[graph-generator] Graph generated successfully.");
}
