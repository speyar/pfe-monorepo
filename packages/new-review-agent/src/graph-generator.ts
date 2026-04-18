import type { SandboxManager } from "@packages/sandbox";

export interface GraphGeneratorOptions {
  rootPath: string;
  outPath: string;
  pretty?: boolean;
}

const GRAPH_CLI_URL =
  "https://github.com/speyar/pfe-monorepo/releases/download/v0.0.1/codebase-graph-cli.js";

export async function generateCodebaseGraph(
  manager: SandboxManager,
  sandboxId: string,
  options: GraphGeneratorOptions,
): Promise<void> {
  const downloadResult = await manager.runCommand({
    sandboxId,
    command: "curl",
    args: ["-L", "-o", "/tmp/codebase-graph-cli.js", GRAPH_CLI_URL],
  });

  if (downloadResult.exitCode !== 0) {
    throw new Error(
      `Failed to download graph CLI: ${downloadResult.stderr || downloadResult.stdout}`,
    );
  }

  const prettyFlag = options.pretty !== false ? "--pretty" : "";

  const result = await manager.runCommand({
    sandboxId,
    command: "node",
    args: [
      "/tmp/codebase-graph-cli.js",
      "--root",
      options.rootPath,
      "--out",
      options.outPath,
      prettyFlag,
    ],
    cwd: options.rootPath,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to generate codebase graph: ${result.stderr || result.stdout}`,
    );
  }
}
