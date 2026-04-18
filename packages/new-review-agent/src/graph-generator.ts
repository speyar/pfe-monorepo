import type { SandboxManager } from "@packages/sandbox";

export interface GraphGeneratorOptions {
  rootPath: string;
  outPath: string;
  pretty?: boolean;
}

const PACKAGE_URL =
  "https://github.com/speyar/pfe-monorepo/releases/download/v0.0.1/codebase-graph-pkg.tar.gz";

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
  const cliDir = `${options.rootPath}/.codebase-graph`;

  console.log("[graph-generator] Downloading codebase-graph CLI...");
  await runCmd(manager, sandboxId, "mkdir", ["-p", cliDir]);

  const downloadResult = await runCmd(manager, sandboxId, "curl", [
    "-L",
    "-o",
    `${cliDir}/pkg.tar.gz`,
    PACKAGE_URL,
  ]);
  if (downloadResult.exitCode !== 0) {
    throw new Error(
      `Failed to download graph CLI: ${downloadResult.stderr || downloadResult.stdout}`,
    );
  }

  console.log("[graph-generator] Extracting...");
  const extractResult = await runCmd(manager, sandboxId, "tar", [
    "-xzf",
    `${cliDir}/pkg.tar.gz`,
    "-C",
    cliDir,
  ]);
  if (extractResult.exitCode !== 0) {
    throw new Error(`Failed to extract: ${extractResult.stderr}`);
  }

  await runCmd(manager, sandboxId, "rm", [`${cliDir}/pkg.tar.gz`]);

  console.log("[graph-generator] Installing ts-morph...");
  const installResult = await runCmd(
    manager,
    sandboxId,
    "npm",
    ["install", "--no-audit", "--no-fund", "ts-morph"],
    cliDir,
  );
  if (installResult.exitCode !== 0) {
    throw new Error(`Failed to install ts-morph: ${installResult.stderr}`);
  }

  const prettyFlag = options.pretty !== false ? "--pretty" : "";

  console.log("[graph-generator] Running codebase-graph...");
  const result = await runCmd(
    manager,
    sandboxId,
    "node",
    [
      `${cliDir}/cli.js`,
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
