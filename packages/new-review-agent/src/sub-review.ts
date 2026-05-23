import { generateText, type LanguageModel } from "ai";
import { reviewFindingSchema } from "./schema/review-result";
import type { ReviewFinding } from "./schema/review-result";
import { z } from "zod";
import type { DependencyNode } from "./v2/types";

export interface SubReviewInput {
  model: LanguageModel;
  files: Array<{ path: string; patch: string }>;
  batchName: string;
  batchIndex: number;
  totalBatches: number;
  allChangedFiles: string[];
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
): string {
  if (!nodes || nodes.length === 0) return "";

  const batchFileSet = new Set(batchFiles ?? []);
  const myNodes = nodes.filter((n) => batchFileSet.has(n.path));

  if (myNodes.length === 0) return "";

  const depContext = [
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
    "Cross-reference: if your batch changes a symbol/export, check if callers in OTHER batches could break.",
  ];

  const batchFileSetLower = new Set(
    (batchFiles ?? []).map((f) => f.toLowerCase()),
  );

  const apiRouteFiles = (batchFiles ?? []).filter(
    (f) =>
      batchFileSetLower.has(f.toLowerCase()) &&
      (f.includes("/api/") || f.endsWith("route.ts") || f.endsWith("route.tsx")),
  );

  if (apiRouteFiles.length > 0) {
    const authImports = myNodes
      .filter(
        (n) =>
          n.imports.some(
            (imp) =>
              imp.toLowerCase().includes("auth") ||
              imp.toLowerCase().includes("clerk") ||
              imp.toLowerCase().includes("session") ||
              imp.toLowerCase().includes("next-auth"),
          ) || n.tags.includes("auth"),
      );

    const unprotectedRoutes = apiRouteFiles
      .filter(
        (f) =>
          !myNodes.some(
            (n) =>
              n.path === f &&
              (n.imports.some(
                (imp) =>
                  imp.toLowerCase().includes("auth") ||
                  imp.toLowerCase().includes("clerk") ||
                  imp.toLowerCase().includes("session"),
              ) ||
                n.tags.includes("auth")),
          ),
      )
      .map((f) => `  ${f} — NO AUTH IMPORTS DETECTED`);

    depContext.push("");
    depContext.push("SECURITY CONTEXT (do NOT skip — this is the most important section):");

    if (unprotectedRoutes.length > 0) {
      depContext.push(
        "⚠️  The following API routes in your batch have NO authentication imports:",
      );
      depContext.push(...unprotectedRoutes);
      depContext.push(
        "Each of these routes may be accessible without authentication. Verify in their diffs.",
      );
    }

    if (authImports.length > 0) {
      depContext.push(
        `✓  These files import auth modules: ${authImports.map((n) => n.path).join(", ")}`,
      );
    }

    depContext.push("");
    depContext.push("SECURITY CHECKLIST (run this checklist against EVERY API route in your batch):");
    depContext.push("1. AUTH CHECK: Does the route verify authentication? Look for auth(), getAuth(), getSession(), or middleware guards.");
    depContext.push("2. IDOR CHECK: Does every prisma query scope by the authenticated user? If a query filters by id/slug only without userId/ownerId, report P0.");
    depContext.push('   Example of IDOR: prisma.review.findUnique({ where: { id } }) — no userId scope = any user can read any review.');
    depContext.push("3. PARAMS CHECK: Can a user change URL params or request body to access/modify another user's data?");
    depContext.push("4. CALLBACK CHECK: If an OAuth/webhook callback is in a protected route group, will it redirect unauthenticated users?");
  }

  return depContext.join("\n");
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

    const result = await generateText({
      model: input.model,
      system,
      prompt,
    });

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
