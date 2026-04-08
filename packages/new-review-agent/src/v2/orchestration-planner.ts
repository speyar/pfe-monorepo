import { createGrepExecutor } from "../tools/GrepTool/execution";
import { normalizePath } from "./utils";
import type { CrossFileCheck, ReviewPlan, ReviewWorkerTask } from "./types";

const JS_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function isCodeFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return JS_TS_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

function extractSymbolsFromPatch(patch: string, max: number): string[] {
  const regex = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;
  const blocked = new Set([
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
  ]);
  const symbols = new Set<string>();
  let match = regex.exec(patch);
  while (match) {
    const symbol = match[0];
    if (!blocked.has(symbol)) {
      symbols.add(symbol);
      if (symbols.size >= max) {
        break;
      }
    }
    match = regex.exec(patch);
  }
  return Array.from(symbols);
}

function computeRiskTags(path: string, patch: string): string[] {
  const tags = new Set<string>();
  const normalized = path.toLowerCase();
  const lowerPatch = patch.toLowerCase();

  if (normalized.includes("auth") || normalized.includes("security")) {
    tags.add("security");
  }
  if (normalized.includes("api") || normalized.includes("route")) {
    tags.add("api-contract");
  }
  if (lowerPatch.includes("throw ") || lowerPatch.includes("catch")) {
    tags.add("error-handling");
  }
  if (lowerPatch.includes("await ") || lowerPatch.includes("promise")) {
    tags.add("async");
  }
  if (lowerPatch.includes("interface ") || lowerPatch.includes("type ")) {
    tags.add("type-surface");
  }

  return Array.from(tags);
}

function sanitizeGrepLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Error:"))
    .filter((line) => line !== "No matches found.");
}

async function findCrossFileChecks(input: {
  sandboxManager: Parameters<typeof createGrepExecutor>[0];
  sandboxId: string;
  changedFile: string;
  patch: string;
}): Promise<CrossFileCheck[]> {
  const grep = createGrepExecutor(input.sandboxManager, input.sandboxId);
  const symbols = extractSymbolsFromPatch(input.patch, 6).filter(
    (symbol) => symbol.length >= 4,
  );

  const checks: CrossFileCheck[] = [];
  for (const symbol of symbols) {
    const output = await grep({
      query: symbol,
      path: ".",
      options: "--fixed-strings --line-number",
      maxResults: 30,
    });
    const lines = sanitizeGrepLines(output);

    const related = new Set<string>();
    for (const line of lines) {
      const filePath = normalizePath(line.split(":", 1)[0] ?? "");
      if (!filePath || filePath === normalizePath(input.changedFile)) {
        continue;
      }
      if (!isCodeFile(filePath)) {
        continue;
      }
      related.add(filePath);
      if (related.size >= 5) {
        break;
      }
    }

    if (related.size > 0) {
      checks.push({
        symbol,
        relatedFiles: Array.from(related),
      });
    }
  }

  return checks;
}

export async function buildReviewPlan(input: {
  sandboxManager: Parameters<typeof createGrepExecutor>[0];
  sandboxId: string;
  changedFiles: string[];
  patchesByFile: Map<string, string>;
  maxTasks: number;
}): Promise<ReviewPlan> {
  const tasks: ReviewWorkerTask[] = [];
  const covered = new Set<string>();
  const allRiskTags = new Set<string>();

  for (const changedFile of input.changedFiles) {
    const normalizedFile = normalizePath(changedFile);
    const patch = input.patchesByFile.get(normalizedFile) ?? "";
    if (!patch.trim()) {
      continue;
    }

    const crossFileChecks = await findCrossFileChecks({
      sandboxManager: input.sandboxManager,
      sandboxId: input.sandboxId,
      changedFile: normalizedFile,
      patch,
    });

    const targetFiles = new Set<string>([normalizedFile]);
    for (const check of crossFileChecks) {
      for (const related of check.relatedFiles) {
        targetFiles.add(related);
      }
    }

    const riskTags = computeRiskTags(normalizedFile, patch);
    for (const tag of riskTags) {
      allRiskTags.add(tag);
    }

    tasks.push({
      id: `task-${tasks.length + 1}`,
      goal: `Review behavioral impact for ${normalizedFile}`,
      changedFile: normalizedFile,
      targetFiles: Array.from(targetFiles).slice(0, 8),
      patch,
      crossFileChecks,
      riskTags,
    });
    covered.add(normalizedFile);

    if (tasks.length >= Math.max(1, input.maxTasks)) {
      break;
    }
  }

  return {
    tasks,
    partialCoverage: covered.size < input.changedFiles.length,
    riskTags: Array.from(allRiskTags),
    changedFilesCovered: Array.from(covered),
  };
}
