import type { SandboxManager } from "@packages/sandbox";

export interface GraphGeneratorOptions {
  rootPath: string;
  outPath: string;
  pretty?: boolean;
}

const GRAPH_CLI_URL =
  "https://github.com/speyar/pfe-monorepo/releases/download/v0.0.1/codebase-graph-cli.js";

async function ensureBunInstalled(
  manager: SandboxManager,
  sandboxId: string,
): Promise<string> {
  const checkResult = await manager.runCommand({
    sandboxId,
    command: "which",
    args: ["bun"],
  });

  if (checkResult.exitCode === 0 && checkResult.stdout.trim()) {
    return checkResult.stdout.trim();
  }

  console.log("[graph-generator] Installing bun in sandbox...");
  const installResult = await manager.runCommand({
    sandboxId,
    command: "bash",
    args: ["-c", "curl -fsSL https://bun.sh/install | bash"],
  });

  if (installResult.exitCode !== 0) {
    throw new Error(`Failed to install bun: ${installResult.stderr}`);
  }

  return "$HOME/.bun/bin/bun";
}

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

  const bunPath = await ensureBunInstalled(manager, sandboxId);

  const prettyFlag = options.pretty !== false ? "--pretty" : "";

  const result = await manager.runCommand({
    sandboxId,
    command: bunPath,
    args: [
      "/tmp/codebase-graph-cli.js",
      "--root",
      options.rootPath,
      "--out",
      options.outPath,
      prettyFlag,
    ],
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to generate codebase graph: ${result.stderr || result.stdout}`,
    );
  }
}
