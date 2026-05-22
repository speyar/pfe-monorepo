import { generateText, type LanguageModel } from "ai";
import { reviewFindingSchema } from "./schema/review-result";
import type { ReviewFinding } from "./schema/review-result";
import { z } from "zod";

export interface SubReviewInput {
  model: LanguageModel;
  files: Array<{ path: string; patch: string }>;
  batchName: string;
  batchIndex: number;
  totalBatches: number;
  allChangedFiles: string[];
}

const subReviewResultSchema = z.object({
  findings: z.array(reviewFindingSchema),
});

export interface SubReviewResult {
  batchName: string;
  findings: ReviewFinding[];
  error?: string;
}

function buildFileDiffText(files: Array<{ path: string; patch: string }>): string {
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

export async function runSubReview(input: SubReviewInput): Promise<SubReviewResult> {
  const fileList = input.files.map((f) => f.path);
  const diffText = buildFileDiffText(input.files);
  const diffSizeKB = Math.round(diffText.length / 1024);

  console.log(`[sub-agent/${input.batchName}] starting — ${input.files.length} files, ${diffSizeKB}KB diff`);
  console.log(`[sub-agent/${input.batchName}] files:`, fileList);

  const startedAt = Date.now();

  try {
    const system = [
      "You are a PR review sub-agent. Review ONLY the files assigned to this batch.",
      "You do NOT have file system access. Analyze solely from the diffs below.",
      "",
      "Focus on: bugs, breaking changes, security issues, data integrity, and production risks.",
      "Be specific. Include file paths and line numbers when possible.",
      "Do NOT report findings for files outside your batch.",
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
      "Diffs for your batch:",
      diffText,
      "",
      "Analyze the diffs and output findings for YOUR batch only.",
    ].join("\n");

    const result = await generateText({
      model: input.model,
      system,
      prompt,
    });

    const elapsedMs = Date.now() - startedAt;
    const findings = parseSubReviewJson(result.text ?? "");

    console.log(`[sub-agent/${input.batchName}] finished — ${findings.length} findings in ${elapsedMs}ms`);
    findings.forEach((f, i) => {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "?";
      console.log(`[sub-agent/${input.batchName}] finding #${i + 1}: [${f.severity}] ${loc} — ${f.title}`);
    });

    return { batchName: input.batchName, findings };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[sub-agent/${input.batchName}] FAILED after ${elapsedMs}ms: ${msg}`);
    return { batchName: input.batchName, findings: [], error: msg };
  }
}
