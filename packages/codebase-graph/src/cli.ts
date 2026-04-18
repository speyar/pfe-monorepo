#!/usr/bin/env node

import path from "node:path";

import { buildCodebaseGraph } from "./builder";
import { exportGraphToJson } from "./export";

interface CliArgs {
  root: string;
  out: string;
  pretty: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, true);
      continue;
    }

    values.set(key, next);
    index += 1;
  }

  const rootValue = values.get("root");
  const outValue = values.get("out");

  return {
    root:
      typeof rootValue === "string" && rootValue.length > 0
        ? path.resolve(rootValue)
        : process.cwd(),
    out:
      typeof outValue === "string" && outValue.length > 0
        ? path.resolve(outValue)
        : path.resolve(process.cwd(), "graph-output", "codebase-graph.json"),
    pretty: values.get("pretty") !== false,
  };
}

function printUsage(): void {
  console.log(
    [
      "Usage: codebase-graph [--root <repo-root>] [--out <file>] [--pretty]",
      "",
      "Examples:",
      "  codebase-graph --root . --out ./graph-output/codebase-graph.json",
      "  codebase-graph --root ../../ --out ../../tmp/graph.json",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  console.error(`[codebase-graph] root=${args.root} out=${args.out}`);
  console.error(`[codebase-graph] cwd=${process.cwd()}`);
  const startedAt = Date.now();

  const { graph } = buildCodebaseGraph({
    rootPath: args.root,
  });

  const snapshot = graph.toSnapshot();
  const outputPath = exportGraphToJson(snapshot, {
    outputPath: args.out,
    pretty: args.pretty,
  });

  const elapsedMs = Date.now() - startedAt;

  console.log(
    `Graph generated at ${outputPath} (nodes=${snapshot.metadata.nodeCount}, edges=${snapshot.metadata.edgeCount}, files=${snapshot.metadata.fileCount}, elapsedMs=${elapsedMs})`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[codebase-graph] Failed: ${message}`);
  process.exitCode = 1;
});
