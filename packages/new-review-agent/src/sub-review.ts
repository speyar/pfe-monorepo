import { generateText, stepCountIs, type LanguageModel } from "ai";
import { reviewFindingSchema } from "./schema/review-result";
import type { ReviewFinding } from "./schema/review-result";
import { z } from "zod";
import type { DependencyNode, PreComputedSecurityContext } from "./v2/types";
import type { SandboxManager } from "@packages/sandbox";
import { createReadFileTool } from "./tools/ReadFileTool";
import { createGrepTool } from "./tools/GrepTool";

export interface SubReviewInput {
  model: LanguageModel;
  files: Array<{ path: string; patch: string }>;
  batchName: string;
  batchIndex: number;
  totalBatches: number;
  allChangedFiles: string[];
  dependencyNodes?: DependencyNode[];
  securityContext?: PreComputedSecurityContext[];
  sandboxManager?: SandboxManager;
  sandboxId?: string;
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
  if (!jsonMatch) {
    console.warn(
      `[sub-agent] JSON parse failed — no JSON object found. Raw text preview:`,
      cleaned.slice(0, 500),
    );
    return [];
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = subReviewResultSchema.parse(parsed);
    return result.findings;
  } catch (err) {
    console.warn(
      `[sub-agent] JSON parse failed — schema validation error:`,
      err instanceof Error ? err.message : String(err),
    );
    console.warn(
      `[sub-agent] Raw JSON parse attempt:`,
      jsonMatch[0].slice(0, 500),
    );
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
  securityContext?: PreComputedSecurityContext[],
): string {
  if (!nodes || nodes.length === 0 && (!securityContext || securityContext.length === 0)) return "";

  const batchFileSet = new Set(batchFiles ?? []);
  const myNodes = (nodes ?? []).filter((n) => batchFileSet.has(n.path));
  const parts: string[] = [];

  if (myNodes.length > 0) {
    parts.push(
      "DEPENDENCY CONTEXT for your batch files:",
      myNodes
        .map((n) => {
          const tags = n.tags.length > 0 ? ` [${n.tags.join(", ")}]` : "";
          const deps =
            n.imports.length > 0
              ? `\n  imports: ${n.imports.slice(0, 5).join(", ")}`
              : "";
          const syms =
            n.symbols.length > 0
              ? `\n  symbols: ${n.symbols.slice(0, 8).join(", ")}`
              : "";
          const refs =
            n.referenceHits > 0
              ? `\n  references: ${n.referenceHits}`
              : "";
          return `  ${n.path}${tags} (churn: ${n.churn})${deps}${syms}${refs}`;
        })
        .join("\n"),
      "",
    );
  }

  const batchFilesList = batchFiles ?? [];
  const apiRouteFiles = batchFilesList.filter(
    (f) =>
      f.includes("/api/") || f.endsWith("route.ts") || f.endsWith("route.tsx"),
  );

  if (apiRouteFiles.length > 0) {
    const routeSecurity = (securityContext ?? []).filter((s) =>
      batchFileSet.has(s.filePath),
    );

    parts.push("SECURITY CONTEXT (do NOT skip):");

    if (routeSecurity.length > 0) {
      for (const s of routeSecurity) {
        parts.push(`--- ${s.filePath} ---`);
        parts.push(`  Auth: ${s.hasAuth ? "YES" : "NONE — P0 RISK"}`);
        if (s.queries.length > 0) {
          for (const q of s.queries) {
            parts.push(
              `  Query: prisma.${q.model}.${q.type} (where: ${q.whereFields.join(", ")}) — ${q.hasUserScoping ? "scoped" : "NO USER SCOPING"}`,
            );
          }
        }
        if (s.riskNotes.length > 0) {
          for (const note of s.riskNotes) {
            parts.push(`  Risk: ${note}`);
          }
        }
      }
    } else {
      parts.push("No pre-computed security context available — must verify manually.");
    }

    parts.push("");
    parts.push("SECURITY CHECKLIST for EVERY API route:");
    parts.push("1. AUTH CHECK: Does the route verify auth? (auth(), getAuth(), getSession())");
    parts.push("2. IDOR CHECK: Does every prisma query scope by the authenticated user?");
    parts.push("3. PARAMS CHECK: Can URL params or body be changed to access another user's data?");
    parts.push("4. CALLBACK CHECK: If OAuth/webhook callback is protected, does it redirect unauthenticated users?");
  }

  return parts.join("\n");
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

  const depContext = buildDependencyContext(
    input.dependencyNodes,
    fileList,
    input.securityContext,
  );

  try {
    const system = [
      "You are a PR review sub-agent. Review the files in your batch from the diffs below.",
      "Focus on: bugs, breaking changes, security issues, data integrity, production risks, and cross-file impacts.",
      "",
      "SECURITY is your highest priority. For every API route or data-access file in your batch:",
      "- Check if every database query (prisma.findUnique, findFirst, delete, update) includes user-scoping in the where clause.",
      "- If a query filters by id alone without userId/ownerId, it's a P0 IDOR vulnerability — ANY authenticated user can access another user's data.",
      "- Check if the route verifies authentication (auth(), getAuth(), getSession()).",
      "",
      "You have the following tools available:",
      "- readFile(path, lineStart?, maxLines?): Read any batch file at specific line ranges.",
      "- grep(query, path?, maxResults?): Search for patterns inside batch files or across the repo.",
      "",
      "Use readFile to verify auth middleware and database query patterns in API route files.",
      "Use grep to check if a changed export/symbol is used by other files.",
      "",
      "Be specific. Include file paths and line numbers when possible.",
      "If a change in your batch affects code in another file, report it — even if that file isn't in your batch.",
      "",
      "CRITICAL: You MUST output a complete JSON object with your findings.",
      "Do NOT get cut off. Produce your JSON output in a single response.",
      "Output a SINGLE JSON object with a 'findings' array. Example:",
      '{"findings": [{"severity":"high","file":"src/a.ts","line":42,"title":"Null dereference","message":"..."}]}',
      "Output ONLY the JSON. No markdown fences, no preamble, no trailing text.",
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
      "Analyze the diffs and output your findings as a JSON object NOW.",
    ].join("\n");

    const readFileTool = input.sandboxManager && input.sandboxId
      ? createReadFileTool(input.sandboxManager, input.sandboxId)
      : undefined;
    const grepTool = input.sandboxManager && input.sandboxId
      ? createGrepTool(input.sandboxManager, input.sandboxId)
      : undefined;

    const tools = {
      ...(readFileTool ? { readFile: readFileTool } : {}),
      ...(grepTool ? { grep: grepTool } : {}),
    };

    const maxSteps = 12;

    const generateOptions: Parameters<typeof generateText>[0] = {
      model: input.model,
      system,
      prompt,
    };
    if (Object.keys(tools).length > 0) {
      generateOptions.tools = tools;
      generateOptions.stopWhen = stepCountIs(maxSteps);
    }

    const result = await generateText(generateOptions);

    const elapsedMs = Date.now() - startedAt;
    const rawText = result.text ?? "";
    const findings = parseSubReviewJson(rawText);

    if (findings.length === 0) {
      console.warn(
        `[sub-agent/${input.batchName}] produced 0 findings. Raw output:`,
        rawText.slice(0, 500),
      );
    }

    console.log(
      `[sub-agent/${input.batchName}] finished — ${findings.length} findings in ${elapsedMs}ms`,
    );
    findings.forEach((f, i) => {
      const loc = f.file
        ? `${f.file}${f.line ? `:${f.line}` : ""}`
        : "?";
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
