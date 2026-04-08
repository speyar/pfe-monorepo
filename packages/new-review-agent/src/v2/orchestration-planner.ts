import { createGrepExecutor } from "../tools/GrepTool/execution";
import { normalizePath } from "./utils";
import type {
  CrossFileCheck,
  ReviewFocusRange,
  ReviewPlan,
  ReviewWorkerTask,
} from "./types";

const JS_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const REVIEWABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const SYMBOL_STOPWORDS = new Set([
  "readme",
  "packages",
  "package",
  "github",
  "review",
  "agent",
  "feature",
  "master",
  "branch",
  "default",
  "export",
  "import",
]);

function isCodeFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return JS_TS_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

function isReviewableFile(path: string): boolean {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".md")) {
    return false;
  }
  if (normalized.endsWith("package.json") || normalized.endsWith("bun.lock")) {
    return false;
  }
  if (normalized.includes("/skills/") || normalized.includes("/dist/")) {
    return false;
  }
  if (normalized.endsWith(".lock")) {
    return false;
  }
  return REVIEWABLE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

function shouldPrioritizeFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.includes("apps/web/src/app/api/webhooks/github") ||
    normalized.includes("packages/new-review-agent/src") ||
    normalized.includes("packages/github-api/src")
  );
}

function isLikelyIdentifier(symbol: string): boolean {
  if (SYMBOL_STOPWORDS.has(symbol.toLowerCase())) {
    return false;
  }
  if (symbol.length < 4) {
    return false;
  }
  const hasUpper = /[A-Z]/.test(symbol);
  const hasUnderscore = symbol.includes("_");
  const camelCase = /^[a-z][a-zA-Z0-9]+$/.test(symbol) && /[A-Z]/.test(symbol);
  return hasUpper || hasUnderscore || camelCase;
}

function extractDeclaredSymbols(changedLines: string): string[] {
  const patterns = [
    /\b(?:function|class|interface|type)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /\bexport\s+(?:const|function|class|type|interface)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
  ];

  const symbols = new Set<string>();
  for (const pattern of patterns) {
    let match = pattern.exec(changedLines);
    while (match) {
      const name = match[1] ?? "";
      if (isLikelyIdentifier(name)) {
        symbols.add(name);
      }
      match = pattern.exec(changedLines);
    }
  }
  return Array.from(symbols);
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
  const changedLines = patch
    .split("\n")
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .join("\n");

  const declared = extractDeclaredSymbols(changedLines);
  if (declared.length >= max) {
    return declared.slice(0, max);
  }

  let match = regex.exec(changedLines);
  while (match) {
    const symbol = match[0];
    if (!blocked.has(symbol) && isLikelyIdentifier(symbol)) {
      symbols.add(symbol);
      if (symbols.size >= max) {
        break;
      }
    }
    match = regex.exec(changedLines);
  }
  const merged = new Set<string>([...declared, ...symbols]);
  return Array.from(merged).slice(0, max);
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

function parseFocusRanges(
  changedFile: string,
  patch: string,
): ReviewFocusRange[] {
  const ranges: ReviewFocusRange[] = [];
  const lines = patch.split("\n");
  const hunkRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

  for (const line of lines) {
    const match = hunkRegex.exec(line);
    if (!match) {
      continue;
    }
    const start = Number.parseInt(match[3] ?? "1", 10);
    const count = Number.parseInt(match[4] ?? "1", 10);
    const safeCount = Number.isFinite(count) && count > 0 ? count : 1;
    const end = Math.max(start, start + safeCount - 1);
    ranges.push({
      file: changedFile,
      startLine: Math.max(1, start - 25),
      endLine: end + 25,
      reason: "changed-hunk-window",
    });
    if (ranges.length >= 6) {
      break;
    }
  }

  if (ranges.length === 0) {
    ranges.push({
      file: changedFile,
      startLine: 1,
      endLine: 220,
      reason: "fallback-no-hunk-headers",
    });
  }

  return ranges;
}

async function findCrossFileChecks(input: {
  sandboxManager: Parameters<typeof createGrepExecutor>[0];
  sandboxId: string;
  changedFile: string;
  patch: string;
}): Promise<CrossFileCheck[]> {
  const grep = createGrepExecutor(input.sandboxManager, input.sandboxId);
  const searchPath = (() => {
    const normalized = normalizePath(input.changedFile);
    const parts = normalized.split("/");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return ".";
  })();
  const symbols = extractSymbolsFromPatch(input.patch, 4).filter(
    (symbol) => symbol.length >= 4,
  );

  const checks: CrossFileCheck[] = [];
  for (const symbol of symbols) {
    const output = await grep({
      query: symbol,
      path: searchPath,
      options: "--line-number -w",
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
  const prioritizedFiles = input.changedFiles
    .map((item) => normalizePath(item))
    .filter((item) => isReviewableFile(item))
    .sort((a, b) => {
      const aPriority = shouldPrioritizeFile(a) ? 1 : 0;
      const bPriority = shouldPrioritizeFile(b) ? 1 : 0;
      return bPriority - aPriority;
    });

  const tasks: ReviewWorkerTask[] = [];
  const covered = new Set<string>();
  const allRiskTags = new Set<string>();

  for (const normalizedFile of prioritizedFiles) {
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
    const focusRanges = parseFocusRanges(normalizedFile, patch);
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
      focusRanges,
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
