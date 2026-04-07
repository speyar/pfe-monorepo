import type { SandboxManager } from "@packages/sandbox";
import { runWithConcurrency } from "./parallel-scheduler";
import {
  normalizePath,
  pathExtension,
  splitLines,
  textPreview,
  uniqueSorted,
} from "./utils";
import type {
  BranchContext,
  DependencyEdge,
  DependencyMap,
  DependencyNode,
} from "./types";

const TAG_BY_EXTENSION: Record<string, string[]> = {
  ".ts": ["typescript"],
  ".tsx": ["typescript", "frontend"],
  ".js": ["javascript"],
  ".jsx": ["javascript", "frontend"],
  ".sql": ["database", "migration"],
  ".prisma": ["database", "schema"],
  ".yml": ["config"],
  ".yaml": ["config"],
  ".json": ["config"],
  ".md": ["docs"],
};

function extractTags(path: string): string[] {
  const normalized = path.toLowerCase();
  const tags = new Set<string>(TAG_BY_EXTENSION[pathExtension(path)] ?? []);

  if (normalized.includes("auth")) tags.add("auth");
  if (normalized.includes("security")) tags.add("security");
  if (normalized.includes("api")) tags.add("api");
  if (normalized.includes("route")) tags.add("api");
  if (normalized.includes("migration")) tags.add("migration");
  if (normalized.includes("schema")) tags.add("schema");
  if (normalized.includes("test")) tags.add("test");
  if (normalized.includes("lock")) tags.add("generated");
  if (normalized.includes("dist/")) tags.add("generated");

  return Array.from(tags);
}

function extractSymbolsFromPatch(patch: string, maxSymbols: number): string[] {
  const symbols = new Set<string>();
  const regex = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;
  let match = regex.exec(patch);
  while (match) {
    const word = match[0];
    if (
      ![
        "const",
        "let",
        "var",
        "function",
        "return",
        "class",
        "await",
        "async",
        "import",
        "export",
        "from",
        "true",
        "false",
        "null",
        "undefined",
        "string",
        "number",
        "boolean",
      ].includes(word)
    ) {
      symbols.add(word);
    }
    if (symbols.size >= maxSymbols) {
      break;
    }
    match = regex.exec(patch);
  }
  return Array.from(symbols);
}

function extractImports(patch: string, maxImports: number): string[] {
  const imports = new Set<string>();
  const regex = /from\s+["']([^"']+)["']/g;
  let match = regex.exec(patch);
  while (match) {
    imports.add(match[1]!);
    if (imports.size >= maxImports) {
      break;
    }
    match = regex.exec(patch);
  }
  return Array.from(imports);
}

function churnScoreFromPatch(patch: string): number {
  const lines = splitLines(patch);
  return lines.filter((line) => line.startsWith("+") || line.startsWith("-"))
    .length;
}

async function searchSymbolReferences(
  sandboxManager: SandboxManager,
  sandboxId: string,
  symbol: string,
): Promise<number> {
  const result = await sandboxManager.runCommand({
    sandboxId,
    command: "rg",
    args: ["--line-number", "--no-heading", "--fixed-strings", symbol, "."],
  });
  const stdout = result.stdout ?? "";
  return splitLines(stdout).length;
}

export async function buildDependencyMap(input: {
  sandboxManager: SandboxManager;
  sandboxId: string;
  branch: BranchContext;
  patchesByFile: Map<string, string>;
  maxSymbols?: number;
}): Promise<DependencyMap> {
  const maxSymbols = Math.max(10, input.maxSymbols ?? 40);

  const nodes: DependencyNode[] = input.branch.changedFiles.map((filePath) => {
    const path = normalizePath(filePath);
    const patch = input.patchesByFile.get(path) ?? "";
    const symbols = extractSymbolsFromPatch(patch, maxSymbols);
    const imports = extractImports(patch, 20);
    const tags = extractTags(path);

    return {
      path,
      extension: pathExtension(path),
      churn: churnScoreFromPatch(patch),
      tags,
      symbols,
      imports,
      referenceHits: 0,
    };
  });

  const allSymbols = uniqueSorted(nodes.flatMap((node) => node.symbols)).slice(
    0,
    maxSymbols,
  );
  const hits = await runWithConcurrency(allSymbols, 6, async (symbol) => {
    const count = await searchSymbolReferences(
      input.sandboxManager,
      input.sandboxId,
      symbol,
    );
    return { symbol, count };
  });

  const bySymbol = new Map<string, number>(
    hits.map((item) => [item.symbol, item.count]),
  );

  for (const node of nodes) {
    node.referenceHits = node.symbols.reduce(
      (sum, symbol) => sum + (bySymbol.get(symbol) ?? 0),
      0,
    );
  }

  const edges: DependencyEdge[] = [];
  for (const node of nodes) {
    for (const imported of node.imports) {
      edges.push({ from: node.path, to: imported, kind: "import" });
    }
    for (const symbol of node.symbols.slice(0, 10)) {
      edges.push({ from: node.path, to: symbol, kind: "symbol" });
    }
  }

  const tags = uniqueSorted(nodes.flatMap((node) => node.tags));
  const hotFiles = nodes
    .slice()
    .sort((a, b) => b.churn + b.referenceHits - (a.churn + a.referenceHits))
    .slice(0, 10)
    .map((node) => node.path);

  const topSymbols = hits
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((item) => item.symbol);

  const summary = [
    `changed files: ${nodes.length}`,
    `graph edges: ${edges.length}`,
    `top tags: ${tags.slice(0, 8).join(", ") || "none"}`,
    `hot files: ${hotFiles.slice(0, 5).join(", ") || "none"}`,
    `top symbols: ${topSymbols.slice(0, 8).join(", ") || "none"}`,
  ].map((line) => textPreview(line, 400));

  return {
    nodes,
    edges,
    tags,
    hotFiles,
    topSymbols,
    summary,
  };
}
