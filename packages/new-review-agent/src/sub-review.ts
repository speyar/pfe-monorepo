import { generateText, type LanguageModel } from "ai";
import { reviewFindingSchema } from "./schema/review-result";
import type { ReviewFinding } from "./schema/review-result";
import { z } from "zod";
import type { SandboxManager } from "@packages/sandbox";
import { createLsTool } from "./tools/LsTool";
import { createGlobTool } from "./tools/GlobTool";
import { createReadFileTool } from "./tools/ReadFileTool";
import { createGrepTool } from "./tools/GrepTool";
import type { DependencyNode } from "./v2/types";

export interface SubReviewInput {
  model: LanguageModel;
  files: Array<{ path: string; patch: string }>;
  batchName: string;
  batchIndex: number;
  totalBatches: number;
  allChangedFiles: string[];
  sandboxManager?: SandboxManager;
  sandboxId?: string;
  graphPath?: string;
  dependencyNodes?: DependencyNode[];
}

const subReviewResultSchema = z.object({
  findings: z.array(reviewFindingSchema),
});

export interface SubReviewResult {
  batchName: string;
  findings: ReviewFinding[];
  error?: string;
}

function buildFileDiffText(
  files: Array<{ path: string; patch: string }>,
): string {
  return files
    .map((f) => {
      return [
        `diff --git a/${f.path} b/${f.path}`,
        `--- a/${f.path}`,
        `+++ b/${f.path}`,
        f.patch,
      ].join("\n");
    })
    .join("\n\n");
}

function parseSubReviewJson(text: string): ReviewFinding[] {
  const cleaned = text.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = subReviewResultSchema.parse(parsed);
    return result.findings;
  } catch {
    try {
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (!arrayMatch) return [];
      const parsed = JSON.parse(arrayMatch[0]);
      const validated = z.array(reviewFindingSchema).safeParse(parsed);
      return validated.success ? validated.data : [];
    } catch {
      return [];
    }
  }
}

function buildDependencyContext(
  nodes?: DependencyNode[],
  batchFiles?: string[],
): string {
  if (!nodes || nodes.length === 0) return "";

  const batchFileSet = new Set(batchFiles ?? []);
  const myNodes = nodes.filter((n) => batchFileSet.has(n.path));

  if (myNodes.length === 0) return "";

  const imports = new Set<string>();
  const symbols = new Set<string>();
  myNodes.forEach((n) => {
    n.imports.forEach((i) => imports.add(i));
    n.symbols.forEach((s) => symbols.add(s));
  });

  return [
    "DEPENDENCY CONTEXT for your batch files:",
    myNodes
      .map((n) => {
        const tags = n.tags.length > 0 ? ` [${n.tags.join(", ")}]` : "";
        const deps = n.imports.length > 0 ? `\n  imports: ${n.imports.slice(0, 5).join(", ")}` : "";
        const syms = n.symbols.length > 0 ? `\n  symbols: ${n.symbols.slice(0, 8).join(", ")}` : "";
        const refs = n.referenceHits > 0 ? `\n  references across codebase: ${n.referenceHits}` : "";
        return `  ${n.path}${tags} (churn: ${n.churn})${deps}${syms}${refs}`;
      })
      .join("\n"),
    "",
    "Cross-reference guidance:",
    "- If your batch changes a symbol, check if there are callers of that symbol in other batches (could be broken).",
    "- If your batch changes an exported interface, check consumers that import these files.",
    "- Be explicit about cross-file issues even if the broken file is not in your batch — note it as a finding referencing the changed file.",
  ].join("\n");
}

export async function runSubReview(
  input: SubReviewInput,
): Promise<SubReviewResult> {
  const fileList = input.files.map((f) => f.path);
  const diffText = buildFileDiffText(input.files);
  const diffSizeKB = Math.round(diffText.length / 1024);

  console.log(
    `[sub-agent/${input.batchName}] starting — ${input.files.length} files, ${diffSizeKB}KB diff`,
  );
  console.log(`[sub-agent/${input.batchName}] files:`, fileList);

  const startedAt = Date.now();

  const hasTools =
    input.sandboxManager && input.sandboxId;

  const depContext = buildDependencyContext(
    input.dependencyNodes,
    fileList,
  );

  try {
    const system = [
      "You are a PR review sub-agent. Review the files assigned to your batch.",
      hasTools
        ? "You HAVE file system access via readFile/ls/glob/grep. Use them to validate your findings against the actual codebase."
        : "You do NOT have file system access. Analyze solely from the diffs below.",
      "",
      "Focus on: bugs, breaking changes, security issues, data integrity, production risks, and cross-file impacts.",
      "Be specific. Include file paths and line numbers when possible.",
      "You MAY report findings for files outside your batch IF they are impacted by changes in your batch files (e.g., a caller that now receives a different return type).",
      "",
      "Cross-reference priority:",
      "- If you change a function signature, check who calls it.",
      "- If you change a data structure, check who consumes it.",
      "- If you change an export, check who imports it.",
      "",
      "Output a SINGLE JSON object with a 'findings' array. Example:",
      '{"findings": [{"severity":"high","file":"src/a.ts","line":42,"title":"...","message":"..."}]}',
      "Output ONLY the JSON. No markdown fences, no preamble.",
    ].join("\n");

    const prompt = [
      `You are reviewing batch ${input.batchIndex}/${input.totalBatches}.`,
      "",
      `All changed files in this PR (${input.allChangedFiles.length} total):`,
      input.allChangedFiles.map((f) => `  ${f}`).join("\n"),
      "",
      `Your batch (${input.files.length} files):`,
      fileList.join("\n"),
      "",
      ...(depContext ? [depContext, ""] : []),
      "Diffs for your batch:",
      diffText,
      "",
      "Analyze the diffs and output findings. Consider cross-file impact within the full PR scope.",
    ].join("\n");

    let tools;
    if (hasTools) {
      tools = {
        ls: createLsTool(input.sandboxManager!, input.sandboxId!),
        glob: createGlobTool(input.sandboxManager!, input.sandboxId!),
        readFile: createReadFileTool(input.sandboxManager!, input.sandboxId!),
        grep: createGrepTool(input.sandboxManager!, input.sandboxId!),
      };
    }

    const result = await generateText({
      model: input.model,
      system,
      prompt,
      ...(tools ? { tools, maxSteps: 8 } : {}),
    });

    const elapsedMs = Date.now() - startedAt;
    const findings = parseSubReviewJson(result.text ?? "");

    console.log(
      `[sub-agent/${input.batchName}] finished — ${findings.length} findings in ${elapsedMs}ms`,
    );
    findings.forEach((f, i) => {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "?";
      console.log(
        `[sub-agent/${input.batchName}] finding #${i + 1}: [${f.severity}] ${loc} — ${f.title}`,
      );
    });

    return { batchName: input.batchName, findings };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `[sub-agent/${input.batchName}] FAILED after ${elapsedMs}ms: ${msg}`,
    );
    return { batchName: input.batchName, findings: [], error: msg };
  }
}
